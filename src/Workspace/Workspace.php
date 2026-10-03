<?php

declare(strict_types=1);

namespace Indaba\Workspace;

interface Workspace
{
    /** Absolute path of the isolated checkout. */
    public function path(): string;

    /** Unified diff of everything changed since the base commit, untracked files included. */
    public function diff(): string;

    /** Idempotent teardown. */
    public function destroy(): void;
}
