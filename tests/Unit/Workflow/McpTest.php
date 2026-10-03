<?php

declare(strict_types=1);

namespace Indaba\Tests\Unit\Workflow;

use Indaba\Core\Exception\McpUnavailableException;
use Indaba\Core\Exception\WorkflowValidationException;
use Indaba\Observability\SpanEnded;
use Indaba\Observability\Tracer;
use Indaba\Runners\AntigravityRunner;
use Indaba\Runners\ClaudeRunner;
use Indaba\Runners\CodexRunner;
use Indaba\Runners\CommandRunner;
use Indaba\Runners\McpCapability;
use Indaba\Runners\McpConfigWriter;
use Indaba\Runners\OpenRouterRunner;
use Indaba\Runners\RunnerRegistry;
use Indaba\Runners\RunRequest;
use Indaba\Runners\RunResult;
use Indaba\Runners\ShellRunner;
use Indaba\Tests\Support\FakeRunner;
use Indaba\Tests\Support\TempDir;
use Indaba\Workflow\Engine\McpPlanner;
use Indaba\Workflow\Engine\StepExecutor;
use Indaba\Workflow\Engine\WorkflowEngine;
use Indaba\Workflow\Engine\WorkflowStatus;
use Indaba\Workflow\Guard\GuardRegistry;
use Indaba\Workflow\Model\McpPolicy;
use Indaba\Workflow\Model\McpServerDefinition;
use Indaba\Workflow\Parser\WorkflowParser;
use Indaba\Workspace\GitWorktreeManager;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Clock\MockClock;
use Symfony\Component\EventDispatcher\EventDispatcher;
use Symfony\Component\HttpClient\MockHttpClient;

final class McpTest extends TestCase
{
    use TempDir;

    private const string HEAD = <<<'YAML'
        version: "1.0"
        name: mcp
        mcp_servers:
          docs:
            command: npx
            args: ["-y", "docs-server"]
            env: {TOKEN: "s3cret \"quoted\""}
          remote:
            url: https://mcp.example.com/sse
        roles:
          coder: {runner: claude, mcp: [docs]}
          local: {runner: noMcp}
        YAML;

    public function testParsesServersRolesStepsAndPolicies(): void
    {
        $wf = (new WorkflowParser())->parse(self::HEAD . <<<'YAML'

            defaults: {mcp_policy: optional}
            steps:
              - {id: a, role: coder, mcp: [remote], mcp_policy: required}
              - {id: b, role: coder}
            YAML);

        self::assertSame('npx', $wf->mcpServers['docs']->command);
        self::assertSame(['-y', 'docs-server'], $wf->mcpServers['docs']->args);
        self::assertSame('https://mcp.example.com/sse', $wf->mcpServers['remote']->url);
        self::assertSame(['docs'], $wf->roles['coder']->mcp);
        self::assertSame(McpPolicy::Optional, $wf->defaultMcpPolicy);
        self::assertSame(McpPolicy::Required, $wf->step('a')->mcpPolicy);
        self::assertNull($wf->step('b')->mcpPolicy);
    }

    public function testPolicyDefaultsToRequired(): void
    {
        $wf = (new WorkflowParser())->parse(self::HEAD . "\nsteps:\n  - {id: a, role: coder}\n");

        self::assertSame(McpPolicy::Required, $wf->defaultMcpPolicy);
    }

    /**
     * @param list<string> $expected
     */
    #[\PHPUnit\Framework\Attributes\DataProvider('invalid')]
    public function testRejectsBadDeclarations(string $yaml, array $expected): void
    {
        try {
            (new WorkflowParser())->parse($yaml);
            self::fail('expected validation failure');
        } catch (WorkflowValidationException $e) {
            foreach ($expected as $fragment) {
                self::assertStringContainsString($fragment, implode("\n", $e->errors));
            }
        }
    }

    /**
     * @return iterable<string, array{string, list<string>}>
     */
    public static function invalid(): iterable
    {
        $base = "version: \"1.0\"\nname: t\nroles:\n  r: {runner: shell}\n";

        yield 'neither command nor url' => [$base . "mcp_servers:\n  x: {args: [a]}\nsteps:\n  - {id: s, role: r}\n", ['exactly one of "command" or "url"']];
        yield 'both command and url' => [$base . "mcp_servers:\n  x: {command: c, url: 'https://a.b'}\nsteps:\n  - {id: s, role: r}\n", ['exactly one']];
        yield 'bad url scheme' => [$base . "mcp_servers:\n  x: {url: 'ftp://a.b'}\nsteps:\n  - {id: s, role: r}\n", ['http or https']];
        yield 'bad server name' => [$base . "mcp_servers:\n  'a.b\"c': {command: c}\nsteps:\n  - {id: s, role: r}\n", ['name must match']];
        yield 'unknown server on a step' => [$base . "steps:\n  - {id: s, role: r, mcp: [ghost]}\n", ['step "s" uses unknown MCP server "ghost"']];
        yield 'unknown server on a role' => ["version: \"1.0\"\nname: t\nroles:\n  r: {runner: shell, mcp: [ghost]}\nsteps:\n  - {id: s, role: r}\n", ['role "r" uses unknown MCP server']];
        yield 'bad policy' => [$base . "defaults: {mcp_policy: sometimes}\nsteps:\n  - {id: s, role: r}\n", ['must be "required" or "optional"']];
    }

    public function testRunnerCapabilities(): void
    {
        self::assertSame(McpCapability::Injected, McpPlanner::capabilityOf(new ClaudeRunner()));
        self::assertSame(McpCapability::Injected, McpPlanner::capabilityOf(new CodexRunner()));
        self::assertSame(McpCapability::AgentManaged, McpPlanner::capabilityOf(new AntigravityRunner()));
        self::assertSame(McpCapability::None, McpPlanner::capabilityOf(new ShellRunner()));
        self::assertSame(McpCapability::None, McpPlanner::capabilityOf(new OpenRouterRunner(new MockHttpClient(), 'k')));
        self::assertSame(McpCapability::None, McpPlanner::capabilityOf(new CommandRunner('x', ['x'])));
        self::assertSame(McpCapability::Injected, McpPlanner::capabilityOf(new CommandRunner('x', ['x'], McpCapability::Injected)));
    }

    public function testPreflightFollowsPolicyAndCapability(): void
    {
        $registry = (new RunnerRegistry())
            ->register(new FakeRunner('claude', static fn(): RunResult => new RunResult(0, '')))
            ->register(new ClaudeRunner())
            ->register(new AntigravityRunner())
            ->register(new ShellRunner());

        $yaml = <<<'YAML'
            version: "1.0"
            name: t
            mcp_servers:
              docs: {command: npx}
            roles:
              injected: {runner: claude-code}
              managed: {runner: antigravity}
              bare: {runner: shell}
            steps:
              - {id: a, role: injected, mcp: [docs]}
              - {id: b, role: managed, mcp: [docs]}
              - {id: c, role: bare, mcp: [docs]}
              - {id: d, role: bare, mcp: [docs], mcp_policy: optional}
            YAML;
        $issues = (new McpPlanner($registry))->preflight((new WorkflowParser())->parse($yaml));

        $byStep = [];
        foreach ($issues as $i) {
            $byStep[$i->stepId] = $i;
        }
        self::assertArrayNotHasKey('a', $byStep);
        self::assertFalse($byStep['b']->isError);
        self::assertStringContainsString('cannot verify', $byStep['b']->message);
        self::assertTrue($byStep['c']->isError);
        self::assertFalse($byStep['d']->isError);
        self::assertStringNotContainsString('npx', $byStep['c']->describe());
    }

    public function testClaudeConfigIsJsonAndTheFileIsPrivateAndRemoved(): void
    {
        $servers = [
            new McpServerDefinition('docs', 'npx', ['-y', 'x'], ['TOKEN' => 'a"b']),
            new McpServerDefinition('remote', url: 'https://mcp.example.com/sse'),
        ];
        $decoded = json_decode(McpConfigWriter::claudeJson($servers), true);

        self::assertIsArray($decoded);
        $configured = $decoded['mcpServers'] ?? [];
        self::assertIsArray($configured);
        self::assertSame(['command' => 'npx', 'args' => ['-y', 'x'], 'env' => ['TOKEN' => 'a"b']], $configured['docs']);
        self::assertSame(['type' => 'http', 'url' => 'https://mcp.example.com/sse'], $configured['remote']);

        // `echo` stands in for claude: it prints the arguments, then the runner must delete the file.
        $result = (new ClaudeRunner(binary: 'echo', extraArgs: [], usePty: false))
            ->run(new RunRequest('go', sys_get_temp_dir(), mcpServers: $servers));
        self::assertMatchesRegularExpression('/^-p go --mcp-config (\S+) --strict-mcp-config$/', trim($result->output));
        $file = explode(' ', trim($result->output))[3] ?? '';
        self::assertNotSame('', $file);
        self::assertFileDoesNotExist($file);

        $path = McpConfigWriter::writeClaudeFile($servers);
        self::assertSame('0600', substr(sprintf('%o', fileperms($path)), -4));
        unlink($path);
    }

    public function testClaudeWithoutServersIsUntouched(): void
    {
        $result = (new ClaudeRunner(binary: 'echo', extraArgs: [], usePty: false))->run(new RunRequest('go', sys_get_temp_dir()));

        self::assertSame("-p go\n", $result->output);
    }

    public function testCodexOverridesAreEscapedTomlValues(): void
    {
        $args = McpConfigWriter::codexArgs([
            new McpServerDefinition('docs', 'npx', ['-y', 'a"b'], ['TOKEN' => 'x y']),
            new McpServerDefinition('remote', url: 'https://mcp.example.com/sse'),
        ]);

        self::assertSame([
            '-c', 'mcp_servers.docs.command="npx"',
            '-c', 'mcp_servers.docs.args=["-y", "a\"b"]',
            '-c', 'mcp_servers.docs.env={TOKEN = "x y"}',
            '-c', 'mcp_servers.remote.url="https://mcp.example.com/sse"',
        ], $args);
    }

    /**
     * @return array{WorkflowEngine, EventDispatcher}
     */
    private function engine(string $repo, RunnerRegistry $registry): array
    {
        $events = new EventDispatcher();
        $tracer = new Tracer(new MockClock(), $events);

        return [new WorkflowEngine(
            new StepExecutor($registry, GuardRegistry::withDefaults(), $tracer),
            $tracer,
            $events,
            new GitWorktreeManager($repo),
        ), $events];
    }

    private const string PIPELINE = <<<'YAML'
        version: "1.0"
        name: p
        mcp_servers:
          docs: {command: npx, args: [server], env: {TOKEN: hunter2}}
        roles:
          injected: {runner: inj, mcp: [docs]}
          bare: {runner: bare}
        steps:
          - {id: a, role: injected}
          - {id: b, role: bare, depends_on: [a], mcp: [docs], mcp_policy: optional}
        YAML;

    public function testEnginePassesInjectedServersAndRecordsOnlyNames(): void
    {
        $repo = $this->makeGitRepo();
        $inj = new FakeRunner('inj', static fn(): RunResult => new RunResult(0, 'ok'));
        $bare = new FakeRunner('bare', static fn(): RunResult => new RunResult(0, 'ok'));
        $inj2 = new class ($inj) implements \Indaba\Runners\RunnerInterface, \Indaba\Runners\McpCapable {
            public function __construct(private FakeRunner $inner) {}

            public function name(): string
            {
                return 'inj';
            }

            public function mcpCapability(): McpCapability
            {
                return McpCapability::Injected;
            }

            public function run(RunRequest $request): RunResult
            {
                return $this->inner->run($request);
            }
        };

        [$engine, $events] = $this->engine($repo, (new RunnerRegistry())->register($inj2)->register($bare));
        $spans = [];
        $events->addListener(SpanEnded::class, static function (SpanEnded $e) use (&$spans): void {
            $spans[$e->span->name] = $e->span->attributes;
        });

        $result = $engine->run((new WorkflowParser())->parse(self::PIPELINE), $repo, 'M1');

        self::assertSame(WorkflowStatus::Completed, $result->status, (string) $result->failureReason);
        self::assertSame('docs', $inj->requests[0]->mcpServers[0]->name);
        self::assertSame([], $bare->requests[0]->mcpServers, 'optional + unsupported: run without it');
        self::assertSame('docs', $spans['step a']['indaba.mcp.servers']);
        self::assertSame('docs', $spans['step b']['indaba.mcp.skipped']);
        self::assertStringNotContainsString('hunter2', json_encode($spans, \JSON_THROW_ON_ERROR));
        self::assertStringNotContainsString('npx', json_encode($spans, \JSON_THROW_ON_ERROR));
    }

    public function testRequiredAndUnsupportedRefusesBeforeAnythingRuns(): void
    {
        $repo = $this->makeGitRepo();
        $bare = new FakeRunner('bare', static fn(): RunResult => new RunResult(0, 'ok'));
        [$engine] = $this->engine($repo, (new RunnerRegistry())->register($bare));

        $yaml = str_replace('mcp_policy: optional', 'mcp_policy: required', str_replace('runner: inj', 'runner: bare', self::PIPELINE));
        try {
            $engine->run((new WorkflowParser())->parse($yaml), $repo, 'M2');
            self::fail('expected a refusal');
        } catch (McpUnavailableException $e) {
            self::assertStringContainsString('step "a" (runner bare), server "docs"', $e->getMessage());
            self::assertStringNotContainsString('hunter2', $e->getMessage());
        }
        self::assertSame([], $bare->requests, 'no agent was started');
    }

    public function testWorkflowWideDefaultCanBeOptional(): void
    {
        $repo = $this->makeGitRepo();
        $bare = new FakeRunner('bare', static fn(): RunResult => new RunResult(0, 'ok'));
        [$engine] = $this->engine($repo, (new RunnerRegistry())->register($bare));

        $yaml = str_replace('runner: inj', 'runner: bare', self::PIPELINE) . "\ndefaults: {mcp_policy: optional}\n";
        $result = $engine->run((new WorkflowParser())->parse($yaml), $repo, 'M3');

        self::assertSame(WorkflowStatus::Completed, $result->status);
    }
}
