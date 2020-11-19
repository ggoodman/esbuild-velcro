export function valueToShapeString(value: unknown) {
  return JSON.stringify(value, valueToShapeReplacer);
}

function valueToShapeReplacer(_key: string, value: unknown) {
  return typeof value === 'object' && value ? value : typeof value;
}
