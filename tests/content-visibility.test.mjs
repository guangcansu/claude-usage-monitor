import test from 'node:test';
import assert from 'node:assert/strict';

import { hasVisibleOpacity } from '../src/content-visibility.js';

function element(opacity, parentElement = null) {
  return { opacity, parentElement };
}

function computedStyle(node) {
  return { opacity: node.opacity };
}

test('rejects a metric element whose computed opacity is zero', () => {
  const metric = element('0');

  assert.equal(hasVisibleOpacity(metric, computedStyle), false);
});

test('rejects a metric element inside an opacity-zero ancestor', () => {
  const hiddenRegion = element('0');
  const metric = element('1', hiddenRegion);

  assert.equal(hasVisibleOpacity(metric, computedStyle), false);
});

test('retains a metric element with nonzero opacity throughout its ancestor chain', () => {
  const visibleRegion = element('0.5');
  const metric = element('1', visibleRegion);

  assert.equal(hasVisibleOpacity(metric, computedStyle), true);
});
