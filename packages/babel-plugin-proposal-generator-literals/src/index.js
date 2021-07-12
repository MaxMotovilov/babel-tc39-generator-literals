import { declare } from "@babel/helper-plugin-utils";
import syntaxGeneratorLiterals from "@babel/plugin-syntax-generator-literals";
import { types as t } from "@babel/core";
import template from "@babel/template";

const symbolFor = template.expression(`Symbol.for(%%STRING%%)`);

const generatorObjectEmpty = template.expression(`
{
  [Symbol.iterator]: function* () {}
}
`);

const generatorObjectNoSpread = template.expression(`
{
  [%%ID_LIST%%]: %%LIST_ARRAY%%,
  [Symbol.iterator]: %%ID_ITERATOR%%,
}
`);

const iteratorFunctionNoSpread = template.expression(`
function* () {
  let result;
  for (const getter of this[%%ID_LIST%%]) {
    result = yield getter();
  }
  return result;
}
`);

const generatorObjectWithSpread = template.expression(`
{
  [%%ID_HEAD%%]: %%HEAD_ARRAY%%,
  [%%ID_TAIL%%]: %%TAIL_FUNC%%,
  [Symbol.iterator]: %%ID_ITERATOR%%,
}
`);

const iteratorFunctionWithSpread = template.expression(`
function* () {
  let iter = this;
  do {
    const head = iter[%%ID_HEAD%%];
    for (let i = 0, len = head.length; i < len; ) {
      const single = head[i++];
      if (single !== null) {
        yield single();
      } else {
        const spread = head[i++];
        yield* spread();
      }
    }
    iter = iter[%%ID_TAIL%%]();
  } while (%%ID_HEAD%% in iter);
  return yield* iter;
}
`);

function getHelper(scope, what, builder) {
  const key = "genexpr:" + what;
  let id = scope.getData(key);
  if (!id) {
    id = scope.generateUidIdentifier(key);
    scope.push({
      id,
      kind: "const",
      init: builder(),
    });
    scope.setData(key, id);
  }
  return t.cloneNode(id);
}

function getSymbolFor(scope, what) {
  return getHelper(scope, what, () =>
    symbolFor({
      STRING: t.stringLiteral("##generatorExpression" + what),
    }),
  );
}

function getIteratorNoSpread(scope) {
  return getHelper(scope, "IteratorNoSpread", () =>
    iteratorFunctionNoSpread({
      ID_LIST: getSymbolFor(scope, "List"),
    }),
  );
}

function getIteratorWithSpread(scope) {
  return getHelper(scope, "IteratorWithSpread", () =>
    iteratorFunctionWithSpread({
      ID_HEAD: getSymbolFor(scope, "Head"),
      ID_TAIL: getSymbolFor(scope, "Tail"),
    }),
  );
}

function makeYieldGetter(expr) {
  return t.isSpreadElement(expr)
    ? [t.nullLiteral(), t.arrowFunctionExpression([], expr.argument)]
    : t.arrowFunctionExpression([], expr);
}

export default declare(api => {
  api.assertVersion(7);

  return {
    name: "proposal-generator-literals",
    inherits: syntaxGeneratorLiterals,
    visitor: {
      GeneratorExpression(path, state) {
        const { elements } = path.node;
        if (elements.length === 0) {
          path.replaceWith(generatorObjectEmpty());
        } else if (elements.some(expr => t.isSpreadElement(expr))) {
          const getters = elements.flatMap(makeYieldGetter);
          const tail = getters.pop();
          const last = elements[elements.length - 1];
          if (t.isSpreadElement(last)) {
            t.assertNullLiteral(getters.pop());
          } else {
            t.assertArrowFunctionExpression(tail);
            tail.body = t.arrayExpression([tail.body]);
          }
          path.replaceWith(
            generatorObjectWithSpread({
              ID_HEAD: getSymbolFor(state.file.scope, "Head"),
              ID_TAIL: getSymbolFor(state.file.scope, "Tail"),
              ID_ITERATOR: getIteratorWithSpread(state.file.scope),
              HEAD_ARRAY: t.arrayExpression(getters),
              TAIL_FUNC: tail,
            }),
          );
        } else {
          const getters = elements.map(makeYieldGetter);
          path.replaceWith(
            generatorObjectNoSpread({
              ID_LIST: getSymbolFor(state.file.scope, "List"),
              ID_ITERATOR: getIteratorNoSpread(state.file.scope),
              LIST_ARRAY: t.arrayExpression(getters),
            }),
          );
        }
      },
    },
  };
});
