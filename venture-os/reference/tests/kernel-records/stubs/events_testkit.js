/** TEST KIT (kernel-records tests only, never shipped): records every event kernel-records emits, for the tests. */
module.exports = {
  on: {
    'person.created': 'lib_testkit.onPersonCreated',
    'company.created': 'lib_testkit.onCompanyCreated',
    'record.merged': 'lib_testkit.onRecordMerged',
    'deal.created': 'lib_testkit.onDealCreated',
    'deal.moved': 'lib_testkit.onDealMoved',
    'deal.closed': 'lib_testkit.onDealClosed',
    'file.added': 'lib_testkit.onFileAdded',
    'file.text_ready': 'lib_testkit.onFileTextReady',
  },
};
