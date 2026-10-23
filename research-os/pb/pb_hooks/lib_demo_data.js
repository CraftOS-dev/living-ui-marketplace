/** Opt-in presentation fixtures, NOT registry results or real research. */
module.exports = [
  {
    name: 'DEMO · Continual Learning Lab', color: 'violet', kind: 'computational',
    question: 'Can adaptive plasticity reduce forgetting without replaying historical data?',
    scope: 'Compare fixed, gated and adaptive plasticity under sequential synthetic tasks. Demo path: reading list → claims map → experiment → manuscript.',
    papers: ['Adaptive plasticity under sequential tasks', 'Gating mechanisms for stable representations', 'Replay-free retention benchmarks', 'Measuring forgetting beyond final accuracy', 'Resource costs of online adaptation'],
    findings: ['Adaptive gating retained 78 percent on earlier toy tasks.', 'A fixed learning rule retained 61 percent in the toy benchmark.', 'Retention gains varied across random seeds.', 'An extra hidden state increased memory cost by 12 percent.', 'A matched-compute control is needed before comparison.'],
    claims: ['Adaptive gating may preserve earlier task performance.', 'Retention should be evaluated across seeds, not one final score.', 'The extra state may exceed the deployment memory budget.', 'A matched-compute control is needed to isolate the mechanism.'],
    experiment: 'Sequential-task retention ablation', condition: 'Learning rule', levels: ['Fixed', 'Adaptive'], measure: 'Retention', unit: '%', values: [[60,62,61,63],[76,79,78,79]],
    hypothesis: 'Adaptive gating increases retention in a toy sequential classification task.',
    taskNames: ['Freeze the toy benchmark protocol', 'Audit the retention metric', 'Run the adaptive-gating ablation', 'Review compute-budget fairness', 'Draft the limitations section', 'Prepare the claims-map walkthrough'],
    note: 'Separate stability from plasticity: a model can retain old tasks simply by refusing to learn new ones. Report new-task accuracy beside retention and record every seed.',
    limitation: 'These invented values illustrate the workflow; they do not establish an algorithmic advantage.',
    manuscript: 'Adaptive plasticity without replay: a synthetic walkthrough',
    reviewQuestion: 'Which toy evaluations report both retention and adaptation costs?'
  },
  {
    name: 'DEMO · Sleep & Memory Review', color: 'blue', kind: 'study',
    question: 'How should a review distinguish sleep-related retention from practice effects?',
    scope: 'A fictional evidence review of sleep, learning and delayed recall. Demo path: protocol → blinded screening → synthesis board → reviewer responses.',
    papers: ['Sleep scheduling and delayed recall', 'Practice effects in repeated memory tests', 'Controlling circadian time in learning studies', 'Preregistered recall scoring protocols', 'Assessing missingness in sleep diaries'],
    findings: ['The toy spaced-sleep group recalled 73 percent of items.', 'The comparison group recalled 65 percent of items.', 'Recall tests differed in delay and scoring.', 'Diary missingness was higher on weekend sessions.', 'A counterbalanced assessment schedule reduced time-of-day imbalance.'],
    claims: ['A sleep-associated retention difference needs practice-effect controls.', 'Assessment timing can confound delayed recall comparisons.', 'Incomplete diaries may bias the retained sample.', 'A prespecified scoring rule improves comparability.'],
    experiment: 'Counterbalanced recall pilot', condition: 'Schedule', levels: ['Comparison', 'Spaced sleep'], measure: 'Recall', unit: '%', values: [[63,65,66,66],[71,74,73,74]],
    hypothesis: 'A counterbalanced design can separate recall changes from assessment order.',
    taskNames: ['Finalize inclusion and exclusion criteria', 'Calibrate two screeners on four abstracts', 'Resolve the practice-effect conflict', 'Check the PRISMA flow counts', 'Draft the evidence-strength paragraph', 'Review synthetic reviewer comments'],
    note: 'Require a clearly defined retention interval and an explicit comparator. Do not equate an association between sleep and recall with a causal intervention effect.',
    limitation: 'No participant information is real. No health or treatment conclusions can be drawn from this demonstration.',
    manuscript: 'Sleep and delayed recall: synthetic review demonstration',
    reviewQuestion: 'Which studies control practice effects when comparing delayed recall?'
  },
  {
    name: 'DEMO · Battery Materials Bench', color: 'green', kind: 'lab',
    question: 'Does a protective coating improve capacity retention under a matched cycling protocol?',
    scope: 'Fictional materials-screening workflow with batch controls, journal deviations and reproducible repository artifacts. Demo path: protocol → runs → results → repository.',
    papers: ['Protective coatings in model electrode cells', 'Batch effects in cycle-life comparisons', 'Reporting capacity retention consistently', 'Reference-cell quality-control procedures', 'Uncertainty across small electrode batches'],
    findings: ['Coated toy cells retained 90 percent after the fixed cycling window.', 'Uncoated toy cells retained 84 percent after the same window.', 'One cell was flagged for a calibration check.', 'A single batch cannot distinguish coating and fabrication effects.', 'Reporting individual cells preserves variability.'],
    claims: ['A coating may improve retention in the toy comparison.', 'Fabrication batch must be controlled alongside the coating.', 'A calibration deviation can change a small-sample conclusion.', 'Individual-cell reporting is preferable to a single pooled mean.'],
    experiment: 'Coating versus baseline cycling pilot', condition: 'Coating', levels: ['Uncoated', 'Protected'], measure: 'Capacity retention', unit: '%', values: [[83,84,85,84],[89,91,90,90]],
    hypothesis: 'A protective layer increases capacity retention in a fixed simulated cycling window.',
    taskNames: ['Lock the matched cycling window', 'Review reference-cell calibration', 'Compare coating groups by cell', 'Document the synthetic deviation', 'Archive the processed results', 'Draft the next-batch protocol'],
    note: 'Keep the raw run sheet immutable and save derived outputs separately. Record a calibration deviation when it occurs rather than silently dropping the affected run.',
    limitation: 'All cells and measurements are synthetic. The fixture is not a chemical protocol or a validated materials result.',
    manuscript: 'Coating-screening pilot: synthetic methods and results',
    reviewQuestion: 'Which comparisons report matched cycling and batch controls?'
  },
  {
    name: 'DEMO · Urban Heat Field Study', color: 'amber', kind: 'field',
    question: 'Can paired sampling distinguish shade effects from differences in time and location?',
    scope: 'Fictional field-monitoring study linking evidence, paired measurements, site-quality notes and a writing plan. Demo path: tasks → field journal → results chart → board.',
    papers: ['Paired shade measurements in model streets', 'Sensor placement and urban temperature bias', 'Time-matched sampling for heat studies', 'Reporting site exclusions transparently', 'Uncertainty in small field-monitoring pilots'],
    findings: ['The synthetic open-site mean temperature was 33 degrees C.', 'The synthetic shaded-site mean was 30 degrees C.', 'One route included a delayed paired observation.', 'Pavement and airflow differed between some site pairs.', 'A larger sample across weather conditions is needed.'],
    claims: ['Shade may reduce temperature in the toy paired measurements.', 'Time-matched sampling is needed for a fair comparison.', 'Site characteristics may explain part of the apparent difference.', 'Multiple weather days are needed before generalizing.'],
    experiment: 'Paired shade-monitoring pilot', condition: 'Site type', levels: ['Open', 'Shaded'], measure: 'Temperature', unit: 'C', values: [[32.4,33.1,33.7,32.8],[29.5,30.2,30.7,29.6]],
    hypothesis: 'Paired shaded sites have a lower toy temperature than open sites at the same time.',
    taskNames: ['Freeze the site-pair selection rule', 'Check sensor co-location offsets', 'Audit the time-matching log', 'Plot each paired observation', 'Write the generalization caveat', 'Prepare the fieldwork demo board'],
    note: 'Pair sites before examining the outcome. Preserve notes about pavement, airflow and delayed observations, and show how these limitations constrain interpretation.',
    limitation: 'Locations and readings are fictional; these numbers are not weather observations or policy evidence.',
    manuscript: 'Paired urban shade monitoring: a synthetic pilot',
    reviewQuestion: 'Which designs explicitly match sites and sampling times?'
  }
];
