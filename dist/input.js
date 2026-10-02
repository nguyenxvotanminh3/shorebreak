// Track physical sources separately: releasing A must not cancel ArrowLeft,
// and releasing a touch button must not cancel the same held keyboard action.
export function createInputState(actions) {
  const sources = new Map();
  const values = Object.fromEntries(actions.map(action => [action, false]));
  function refresh(action) {
    values[action] = [...sources.values()].includes(action);
  }
  return {
    values,
    press(source, action) {
      if (!(action in values)) return;
      const previous = sources.get(source);
      sources.set(source, action);
      if (previous && previous !== action) refresh(previous);
      values[action] = true;
    },
    release(source) {
      const action = sources.get(source);
      sources.delete(source);
      if (action) refresh(action);
    },
    clear() {
      sources.clear();
      for (const action in values) values[action] = false;
    },
  };
}
