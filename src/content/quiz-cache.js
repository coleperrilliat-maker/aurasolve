import {sendExtension} from '../shared/messaging.js';

// One request answers the whole form or quiz. Later highlights only look here.
export function createQuizCache() {
  const byId = new Map();
  let pending = null;
  return {
    prime(questions) {
      if (!questions?.length) return Promise.resolve(byId);
      pending = sendExtension({type: 'quizPrefetch', questions}).then(data => {
        for (const answer of data?.answers || []) byId.set(String(answer.id), answer);
        return byId;
      }).catch(error => {
        pending = null;
        console.warn('AuraSolve:', error.message);
        return byId;
      });
      return pending;
    },
    async get(id) {
      if (pending) await pending;
      return byId.get(String(id)) || null;
    },
  };
}

export function asFormAnswer(answer, rows = []) {
  const choices = Array.isArray(answer?.choices) ? answer.choices : [];
  const blanks = Array.isArray(answer?.blanks) ? answer.blanks : [];
  return {
    choices,
    text: blanks[0] || '',
    rows: rows.map((row, index) => ({row, choices: blanks[index] ? [blanks[index]] : []})),
    blanks,
  };
}
