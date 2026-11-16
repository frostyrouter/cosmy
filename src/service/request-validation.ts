import { InvalidRequestError } from '../domain/errors.js';
import type { ResponseRequest } from '../domain/types.js';

export function validateConversation(request: ResponseRequest): void {
  const pending = new Map<string, string>();
  const seen = new Set<string>();
  const declaredTools = new Set(request.tools?.map((tool) => tool.name) ?? []);
  for (const [index, message] of request.messages.entries()) {
    const calls = message.toolCalls ?? [];
    if (message.role !== 'assistant' && calls.length) throw invalid(index, 'toolCalls are allowed only on assistant messages');
    if (message.role === 'assistant' && message.content.length === 0 && calls.length === 0) throw invalid(index, 'assistant message must contain text or tool calls');
    if ((message.role === 'system' || message.role === 'user') && message.content.length === 0) throw invalid(index, 'message content must not be empty');
    if (message.role !== 'tool' && (message.toolCallId !== undefined || message.toolError !== undefined)) throw invalid(index, 'tool result fields are allowed only on tool messages');
    if (pending.size && message.role !== 'tool') throw invalid(index, 'all pending tool calls must receive results before the conversation continues');
    for (const call of calls) {
      if (!declaredTools.has(call.name)) throw invalid(index, `tool call '${call.name}' is not declared by this request`);
      if (seen.has(call.id)) throw invalid(index, `duplicate tool call ID '${call.id}'`);
      seen.add(call.id); pending.set(call.id, call.name);
    }
    if (message.role === 'tool') {
      if (!message.toolCallId) throw invalid(index, 'tool message requires toolCallId');
      if (!message.name) throw invalid(index, 'tool message requires name');
      const expectedName = pending.get(message.toolCallId);
      if (!expectedName) throw invalid(index, `toolCallId '${message.toolCallId}' does not reference a pending call`);
      if (expectedName !== message.name) throw invalid(index, `tool result name does not match call '${message.toolCallId}'`);
      pending.delete(message.toolCallId);
    }
  }
  if (pending.size) throw new InvalidRequestError('Every assistant tool call must have a corresponding tool result before continuation');
}

function invalid(index: number, message: string): InvalidRequestError {
  return new InvalidRequestError(`messages[${index}]: ${message}`);
}
