<?php

declare(strict_types=1);

namespace Indaba\Mesh;

enum MessageType: string
{
    case Proposal = 'PROPOSAL';
    case Critique = 'CRITIQUE';
    case Agreement = 'AGREEMENT';
    case Question = 'QUESTION';
    case ToolIntent = 'TOOL_INTENT';
}
