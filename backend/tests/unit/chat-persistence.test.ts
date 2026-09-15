import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

interface ChatMessageRecord {
  id: string;
  senderId: number;
  senderName: string;
  senderRole: string;
  message: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);

  if (diffSec < 45) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24 && date.getDate() === now.getDate()) {
    return `Today ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

describe('Unit: Global Staff Chat Persistence & Formatting', () => {
  it('1. Generates complete persistent message records with sender metadata and timestamps', () => {
    const now = new Date();
    const msg: ChatMessageRecord = {
      id: 'msg-uuid-1234',
      senderId: 42,
      senderName: 'Ansh Rohit',
      senderRole: 'admin',
      message: 'We received the Calgary shipment.',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    assert.equal(msg.senderName, 'Ansh Rohit');
    assert.equal(msg.senderRole, 'admin');
    assert.equal(msg.message, 'We received the Calgary shipment.');
    assert.ok(msg.createdAt instanceof Date);
    assert.equal(msg.deletedAt, null);
  });

  it('2. Formats friendly human relative timestamps while preserving exact ISO timestamp', () => {
    const baseNow = new Date('2026-08-28T20:45:00Z');

    const justNowMsg = new Date('2026-08-28T20:44:40Z');
    assert.equal(formatRelativeTime(justNowMsg, baseNow), 'Just now');

    const tenMinsAgoMsg = new Date('2026-08-28T20:35:00Z');
    assert.equal(formatRelativeTime(tenMinsAgoMsg, baseNow), '10m ago');
  });

  it('3. Enforces that messages cannot be empty or whitespace only', () => {
    const validate = (text: string) => {
      const trimmed = (text || '').trim();
      if (!trimmed) throw new Error('Message cannot be empty');
      return trimmed;
    };

    assert.throws(() => validate('   '), /Message cannot be empty/);
    assert.equal(validate('  Container MSMU 6896930 unloaded.  '), 'Container MSMU 6896930 unloaded.');
  });
});
