import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ValidationError,
  cleanField,
  discordTimestamp,
  escapeMarkdown,
  fitText,
  humanDelta,
  sanitizeText,
  stripInvisible,
} from '../src/text.js';

describe('sanitizeText', () => {
  it('escape markdown', () => {
    assert.equal(escapeMarkdown('a*b_c'), 'a\\*b\\_c');
  });

  it('vô hiệu hoá mention và link giả', () => {
    const cleaned = sanitizeText('@everyone **bold** [x](http://evil)');
    // '@' bị escape thành '\\@' nên Discord không ping và không render mention.
    assert.ok(cleaned.includes('\\@everyone'));
    assert.ok(!cleaned.includes('**bold**'));
    assert.ok(!cleaned.includes('[x](http://evil)'));
    assert.ok(cleaned.includes('\\*\\*bold\\*\\*'));
  });

  it('bỏ ký tự zero-width và RTL override', () => {
    assert.equal(stripInvisible('ad\u200bmin\u202e\u200f'), 'admin');
  });

  it('giữ ZWJ để không phá emoji', () => {
    assert.equal(stripInvisible('👨\u200d👩'), '👨\u200d👩');
  });

  it('gộp xuống dòng khi singleLine', () => {
    assert.equal(sanitizeText('a\n\nb'), 'a b');
    assert.equal(sanitizeText('a\n\nb', { singleLine: false, escape: false }), 'a\n\nb');
  });

  it('cắt ngắn kèm dấu …', () => {
    const out = sanitizeText('x'.repeat(50), { maxLen: 10 });
    assert.equal([...out].length, 10);
    assert.ok(out.endsWith('…'));
  });

  it('giữ nguyên dấu tiếng Việt', () => {
    assert.equal(sanitizeText('Nguyễn Đức Anh'), 'Nguyễn Đức Anh');
  });

  it('xử lý null và số', () => {
    assert.equal(sanitizeText(null), '');
    assert.equal(sanitizeText(123), '123');
  });
});

describe('cleanField', () => {
  it('chấp nhận giá trị hợp lệ', () => {
    assert.equal(
      cleanField('  csnhng  ', { name: 'handle', maxLen: 64, context: 't' }),
      'csnhng',
    );
  });

  it('từ chối trường bắt buộc rỗng', () => {
    assert.throws(() => cleanField('', { name: 'handle', maxLen: 64, context: 't' }), ValidationError);
  });

  it('từ chối quá dài', () => {
    assert.throws(
      () => cleanField('x'.repeat(65), { name: 'handle', maxLen: 64, context: 't' }),
      ValidationError,
    );
  });

  it('từ chối type sai định dạng', () => {
    assert.throws(
      () => cleanField('GIT HUB', { name: 'type', maxLen: 32, context: 't' }),
      ValidationError,
    );
  });

  it('cho phép nhiều dòng khi singleLine=false', () => {
    assert.equal(
      cleanField('dòng 1\ndòng 2', {
        name: 'note',
        maxLen: 100,
        context: 't',
        required: false,
        singleLine: false,
      }),
      'dòng 1\ndòng 2',
    );
  });
});

describe('humanDelta', () => {
  const now = new Date('2026-11-17T00:00:00Z');
  const back = (ms) => new Date(now.getTime() - ms);

  it('đơn vị thời gian', () => {
    assert.equal(humanDelta(back(10 * 1000), now), '10 giây');
    assert.equal(humanDelta(back(5 * 60 * 1000), now), '5 phút');
    assert.equal(humanDelta(back(3 * 60 * 60 * 1000), now), '3 giờ');
    assert.equal(humanDelta(back(3 * 24 * 60 * 60 * 1000), now), '3 ngày');
    assert.ok(humanDelta(back(45 * 24 * 60 * 60 * 1000), now).startsWith('1 tháng'));
    assert.ok(humanDelta(back(800 * 24 * 60 * 60 * 1000), now).startsWith('2 năm'));
  });

  it('thời gian tương lai bị chặn', () => {
    assert.equal(humanDelta(new Date(now.getTime() + 86400000), now), 'vừa xong');
  });
});

describe('tiện ích khác', () => {
  it('fitText', () => {
    assert.equal(fitText('abcdef', 4), 'abc…');
    assert.equal(fitText('abc', 10), 'abc');
  });

  it('discordTimestamp', () => {
    const stamp = discordTimestamp(new Date('2026-01-01T00:00:00Z'), 'f');
    assert.match(stamp, /^<t:\d+:f>$/);
    assert.equal(discordTimestamp('không-phải-ngày'), 'không rõ');
  });
});
