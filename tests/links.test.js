import test from 'node:test';
import assert from 'node:assert/strict';
import { safeExternalUrl, updateChapterLink } from '../src-common/Links.js';

test('chapter URLs only allow external HTTP(S) destinations', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd', 'relative', undefined]) {
        assert.equal(safeExternalUrl(url), null);
    }
    assert.equal(safeExternalUrl('https://example.org/chapter'), 'https://example.org/chapter');
});

test('metadata is displayed as text, with no HTML parsing', () => {
    const classes = new Set();
    const element = {
        classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
        removeAttribute(name) { delete this[name]; },
        set innerHTML(_) { throw new Error('untrusted HTML must never be parsed'); },
    };
    updateChapterLink(element, 'https://example.org/<img src=x onerror=alert(1)>');
    assert.ok(classes.has('visible'));
    assert.ok(element.textContent.includes('%3Cimg'));
    updateChapterLink(element, 'javascript:alert(1)');
    assert.equal(element.href, undefined);
    assert.equal(element.textContent, '');
    assert.ok(!classes.has('visible'));
});
