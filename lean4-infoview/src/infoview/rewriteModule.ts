import { ImportType, parse } from "es-module-lexer";

const a = "a".charCodeAt(0);
const z = "z".charCodeAt(0);
const A = "A".charCodeAt(0);
const Z = "Z".charCodeAt(0);
const zero = "0".charCodeAt(0);
const nine = "9".charCodeAt(0);
const under = "_".charCodeAt(0);

function isIdent(c: number) {
  return (
    (a <= c && c <= z) ||
    (A <= c && c <= Z) ||
    (zero <= c && c <= nine) ||
    c === under
  );
}

function canStartIdent(c: number) {
  return (a <= c && c <= z) || (A <= c && c <= Z) || c === under;
}

function parseImport(source: string) {
  const res = {
    all: undefined as undefined | string,
    name: [] as [string, string][],
  };
  let i = 0;

  function skipWhitespaceAndComment() {
    for (; i < source.length; i += 1) {
      const curr = source[i];

      if (curr === " " || curr === "\t" || curr === "\n" || curr === "\r") {
        continue;
      }

      if (curr === "/") {
        if (source[i + 1] === "/") {
        } else if (source[i + 1] === "*") {
        }

        throw new TypeError("Invalid JS");
      }

      break;
    }
  }

  function skipImport() {
    skipWhitespaceAndComment();

    if (source.substring(i, i + 6) === "import") {
      i += 6;
    } else {
      throw new TypeError("Invalid JS");
    }
  }

  function parseIdent() {
    if (!canStartIdent(source.charCodeAt(i))) {
      throw new TypeError("Invalid JS");
    }

    const start = i;

    while (i < source.length && isIdent(source.charCodeAt(i))) {
      i += 1;
    }

    return source.slice(start, i);
  }

  function parseNamedImport(): [string, string] {
    const origName = parseIdent();

    skipWhitespaceAndComment();

    if (source.substring(i, i + 2) === "as") {
      i += 2;
      skipWhitespaceAndComment();

      const importName = parseIdent();

      return [origName, importName];
    }

    return [origName, origName];
  }

  function parseImportItem() {
    skipWhitespaceAndComment();

    const curr = source[i];

    if (curr === "*") {
      i += 1;
      skipWhitespaceAndComment();

      if (source.substring(i, i + 2) !== "as") {
        throw new TypeError("Invalid JS");
      }

      i += 2;

      skipWhitespaceAndComment();

      const name = parseIdent();
      res.all = name;
    } else if (curr === "{") {
      i += 1;

      while (i < source.length) {
        skipWhitespaceAndComment();
        const name = parseNamedImport();
        res.name.push(name);
        skipWhitespaceAndComment();

        if (source[i] === ",") {
          i += 1;
        } else {
          break;
        }
      }
    } else if (canStartIdent(source.charCodeAt(i))) {
      const name = parseIdent();
      res.name.push(["default", name]);
    }
  }

  skipImport();

  while (i < source.length) {
    parseImportItem();
    skipWhitespaceAndComment();

    if (source[i] === ",") {
      i += 1;
    } else {
      break;
    }
  }

  return res;
}

function processImportName(name: string | undefined) {
  const prefix = "window.__SECRET_INTERNAL_PKG_INFOVIEW__.";
  if (name === "react") {
    return prefix + "r";
  } else if (name === "react/jsx-runtime") {
    return prefix + "j";
  } else if (name === "@leanprover/infoview") {
    return prefix + "iv";
  } else {
    throw new TypeError("__SECRET_INTERNAL_PKG_INFOVIEW__: Unsupported package");
  }
}

export async function rewriteModule(source: string) {
  const [im, _] = await parse(source);

  let res = source;

  for (const i of im) {
    const imSource = source.substring(i.ss, i.se);
    const packageName = processImportName(i.n);

    if (i.t === ImportType.Static) {
      const parseRes = parseImport(imSource);

      let output = "";

      if (parseRes.all) {
        output += `const ${parseRes.all} = ${packageName};`;
      }

      if (parseRes.name.length > 0) {
        const objStr = parseRes.name
          .map(([name, bind]) => (name === bind ? name : `${name}: ${bind}`))
          .join(",");
        output += `const {${objStr}} = ${packageName};`;
      }
      res = res.replace(imSource, output);
    } else if (i.t === ImportType.Dynamic) {
      const output = `Promise.resolve(${packageName})`;
      res = res.replace(imSource, output);
    } else {
      throw new TypeError("Unsupported feature");
    }
  }

  return res;
}
