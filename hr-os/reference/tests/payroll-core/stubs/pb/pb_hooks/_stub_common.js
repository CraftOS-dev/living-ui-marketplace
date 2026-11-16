/* SCRATCH ONLY (payroll-core tests): never shipped. Test-controlled data for the
 * other modules' contract functions, read from APP/.stub-data.json; calls of
 * the mark functions are appended to APP/.stub-calls.json. */
function root() {
  return $filepath.join(__hooks, '..', '..');
}
function data() {
  try {
    return JSON.parse(toString($os.readFile($filepath.join(root(), '.stub-data.json'))));
  } catch (e) {
    return {};
  }
}
function calls() {
  try {
    return JSON.parse(toString($os.readFile($filepath.join(root(), '.stub-calls.json'))));
  } catch (e) {
    return [];
  }
}
function record(name, args) {
  const list = calls();
  list.push({ fn: name, args: args, at: new Date().toISOString() });
  $os.writeFile($filepath.join(root(), '.stub-calls.json'), JSON.stringify(list), 0o644);
}
module.exports = { data: data, calls: calls, record: record };
