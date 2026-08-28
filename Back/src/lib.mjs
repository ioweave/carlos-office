const clean = input => String(input ?? "").trim();

const escapeStringControls = input => {
  const source = input;
  let result = "";
  let quoted = false;
  let stringValue = "";
  let windowsPath = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (!quoted) {
      result += character;
      if (character === '"') {
        quoted = true;
        stringValue = "";
        windowsPath = false;
      }
      continue;
    }

    if (character === '"') {
      result += character;
      quoted = false;
      continue;
    }

    if (character === "\\") {
      if (!windowsPath && /^[A-Za-z]:$/.test(stringValue)) windowsPath = true;
      if (windowsPath) {
        result += "\\\\";
        stringValue += "\\";
        continue;
      }

      const next = source[index + 1];
      if ('"\\/bfnrt'.includes(next)) {
        result += `\\${next}`;
        stringValue += next;
        index += 1;
        continue;
      }

      if (next === "u" && /^[0-9a-fA-F]{4}$/.test(source.slice(index + 2, index + 6))) {
        result += source.slice(index, index + 6);
        stringValue += source.slice(index, index + 6);
        index += 5;
        continue;
      }

      result += "\\\\";
      stringValue += "\\";
      continue;
    }

    if (character === "\n") result += "\\n";
    else if (character === "\r") result += "\\r";
    else if (character === "\t") result += "\\t";
    else if (character === "\b") result += "\\b";
    else if (character === "\f") result += "\\f";
    else if (character.charCodeAt(0) < 0x20) {
      result += `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
    } else result += character;
    stringValue += character;
  }

  return result;
};

const findEnd = (source, start) => {
  const first = source[start];
  if (first !== "{" && first !== "[") return -1;

  const stack = [first];
  let quoted = false;
  let escaped = false;

  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];

    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }

    if (character === '"') {
      quoted = true;
      continue;
    }

    if (character === "{" || character === "[") {
      stack.push(character);
      continue;
    }

    if (character !== "}" && character !== "]") continue;

    const opener = character === "}" ? "{" : "[";
    if (stack.at(-1) !== opener) return -1;

    stack.pop();
    if (!stack.length) return index;
  }

  return -1;
};

const parse = string => {
  try {
    return { ok: true, value: JSON.parse(escapeStringControls(string)) };
  } catch {
    return { ok: false, value: null };
  }
};

const parseStrict = string => {
  try {
    return { ok: true, value: JSON.parse(string) };
  } catch {
    return { ok: false, value: null };
  }
};

const stripJsonFence = input => {
  let string = clean(input);
  if (!string.startsWith("```")) return string;

  string = string.replace(/^```(?:json)?\s*/i, "");
  return clean(string.replace(/\s*```$/, ""));
};

const closeMissingContainers = input => {
  const source = clean(input);
  if (source[0] !== "{" && source[0] !== "[") return null;

  const stack = [];
  let quoted = false;
  let escaped = false;

  for (const character of source) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }

    if (character === '"') {
      quoted = true;
      continue;
    }

    if (character === "{" || character === "[") {
      stack.push(character);
      continue;
    }

    if (character !== "}" && character !== "]") continue;
    const opener = character === "}" ? "{" : "[";
    if (stack.at(-1) !== opener) return null;
    stack.pop();
  }

  if (quoted || !stack.length) return null;
  const closers = stack.reverse().map(opener => opener === "{" ? "}" : "]").join("");
  return source + closers;
};

const completeStructures = source => {
  const result = [];
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }

    if (character === '"') {
      quoted = true;
      continue;
    }

    if (character !== "{" && character !== "[") continue;
    const end = findEnd(source, index);
    if (end < 0) continue;

    result.push(source.slice(index, end + 1));
    index = end;
  }

  return result;
};

const parseCandidate = source => {
  const exact = parseStrict(source);
  return exact.ok ? exact : parse(source);
};

export const parseProviderJSON = input => {
  const source = stripJsonFence(input);
  if (!source) throw new Error("Provider returned an empty response");

  const direct = parseCandidate(source);
  if (direct.ok) return direct.value;

  const completed = closeMissingContainers(source);
  if (completed) {
    const recovered = parseCandidate(completed);
    if (recovered.ok) return recovered.value;
  }

  const values = completeStructures(source)
    .map(parseCandidate)
    .filter(candidate => candidate.ok)
    .map(candidate => candidate.value);

  if (values.length === 1) return values[0];
  if (values.length > 1) throw new Error(`Provider returned ${values.length} JSON values; response is ambiguous`);
  throw new Error("Provider response does not contain valid JSON");
};

const repairObject = string => {
  const fragment = string.replace(/^,+\s*/, "");

  for (const candidate of [
    `{${fragment}`,
    `{${fragment}}`,
    `{"${fragment}`,
    `{"${fragment}}`,
  ]) {
    const parsed = parse(candidate);
    if (parsed.ok) return parsed.value;
  }

  return null;
};

export const JSONparser = (input, valid = true) => {
  let result = {};
  let string = clean(input);

  if (!string) return result;

  if (valid) {
    const parsed = parse(string);
    if (parsed.ok) return parsed.value;

    const repaired = repairObject(string);
    if (repaired !== null) return repaired;

    return JSONparser(string, false);
  }

  const outerEnd = (string[0] === "{" || string[0] === "[") ? findEnd(string, 0) : -1;
  if (outerEnd === string.length - 1) string = clean(string.slice(1, -1));

  let cursor = 0;
  let order = 1;
  let quoted = false;
  let escaped = false;

  const add = (type, value) => {
    const cleanValue = type === "text" ? clean(value) : value;
    if (cleanValue === "") return;
    result[`${String(order++).padStart(5, "0")}_${type}`] = cleanValue;
  };

  for (let index = 0; index < string.length; index += 1) {
    const character = string[index];

    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }

    if (character === '"') {
      quoted = true;
      continue;
    }

    if (character !== "{" && character !== "[") continue;

    const end = findEnd(string, index);
    if (end < 0) continue;

    add("text", string.slice(cursor, index));
    add(character === "{" ? "object" : "array", JSONparser(string.slice(index, end + 1)));

    index = end;
    cursor = end + 1;
  }

  add("text", string.slice(cursor));
  return result;
};
