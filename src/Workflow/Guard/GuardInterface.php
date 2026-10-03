<?php

declare(strict_types=1);

namespace Indaba\Workflow\Guard;

use Indaba\Workflow\Model\GuardDefinition;
use Indaba\Workflow\Model\GuardType;

interface GuardInterface
{
    public function type(): GuardType;

    /**
     * @param string $workdir directory the step ran in
     */
    public function check(GuardDefinition $guard, string $workdir): GuardResult;
}
