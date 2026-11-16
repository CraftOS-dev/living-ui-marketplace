/** SCRATCH STUB (committee tests only, never shipped): lib_diligence.answersFor. */
function answersFor(app, dealId) {
  return { questions: [{ id: 'q1', text: 'Net revenue retention' }], answers: [{ question: 'q1', value: '118%', status: 'confirmed' }], deal: dealId };
}
module.exports = { answersFor: answersFor };
