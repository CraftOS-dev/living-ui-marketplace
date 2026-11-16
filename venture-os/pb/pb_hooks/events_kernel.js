/**
 * Kernel registrations (SPEC 4.2): the kernel's own Next items (proposals,
 * outbound drafts, tasks due) and its trigger question_asked (a question a
 * person typed for your AI agent; lib_agent.js). Plain data.
 *
 * Kernel events other modules can subscribe to:
 *   entity.created    { entity, kind }
 *   entity.updated    { entity, kind }
 *   setup.completed   { firm, fund, member }
 *   outbound.sent     { outbound, kind, module, ref_collection, ref_id, deal }
 *   outbound.failed   { outbound, kind, module, ref_collection, ref_id, deal }
 */
module.exports = {
  on: {},
  needsYou: 'lib_next.kernelItems',
  triggers: {
    question_asked: {
      record: 'agent_asks',
      param: 'ask_id',
      perm: 'signed',
      ask: false,
      label: 'Answer a question',
      description: 'Your AI agent answers a question or does what a person told it in the app; the answer shows under the ask',
      fires: 'Tell your AI agent (the Ask bar, the agent panel, Ctrl K)',
      cooldown: 10,
      ended: 'lib_agent.onAskCannot',
      instruction:
        "Answer or do what a person typed in Venture OS (question ask_id). 1) chat.get --ask <ask_id>: the question, where the person was (context), the top of their Next (asker_next) and the local time; next.list --member <them> reads more while it waits. 2) Read what you need through the ops (search.query, the module ops of the topic); answer only from what the app returned and what the asker may see; unknown stays unknown. 3) A change: make it through its op (it may become a proposal) and say what the app returned. Something only people do (advance, vote, approve, send): say where they do it; never ask for a PIN. 4) chat.answer --ask <ask_id> --answer \"<short plain answer with the numbers, dates and record names you used>\" (marks it done).",
    },
  },
};
