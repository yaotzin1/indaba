// A tiny ACP agent for tests: speaks newline-delimited JSON-RPC on stdin and stdout.
// FAKE_MODE: ok (default) | silent | banner | exit | env
import { createInterface } from 'node:readline';

const mode = process.env.FAKE_MODE ?? 'ok';
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

if (mode === 'banner') {
  process.stdout.write('Welcome to the fake agent v1\n');
}
if (mode === 'exit') {
  process.stderr.write('fake agent: cannot start\n');
  process.exit(3);
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  switch (message.method) {
    case 'initialize':
      send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } });
      break;
    case 'session/new':
      send({ id: message.id, result: { sessionId: 'fx' } });
      break;
    case 'session/prompt': {
      if (mode === 'silent') {
        break;
      }
      const text =
        mode === 'env'
          ? JSON.stringify(Object.keys(process.env).sort())
          : `pong:${message.params.prompt[0].text}`;
      send({
        method: 'session/update',
        params: {
          sessionId: 'fx',
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
        },
      });
      send({ id: message.id, result: { stopReason: 'end_turn' } });
      break;
    }
    default:
      break;
  }
});
