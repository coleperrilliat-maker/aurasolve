// One required, typed answer slot per blank. With a strict JSON schema the
// model cannot skip a blank, answer a dropdown as text, or invent a choice.
const short = (text, limit = 120) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
const numbered = (items, label) => items.map((item, index) => `${index + 1}) ${short(label(item)) || `option ${index + 1}`}`);
const picked = (value, list) => list[Number(String(value ?? '').match(/^\s*(\d+)\)/)?.[1]) - 1];
const action = (kind, target, value) => ({kind, target, value: String(value ?? ''), destination: '', x: null, y: null});
const describe = field => short([field.label && `Label: ${field.label}.`, field.context && `Context: ${field.context}.`].filter(Boolean).join(' '), 300);
const open = field => (field.options || []).filter(option => !option.disabled);

export function answerSlots(fields = [], dropTargets = []) {
  const slots = [], groups = new Map();
  for (const field of fields) {
    if (field.kind === 'radio') {
      const key = field.group || '';
      if (!groups.has(key)) {
        const slot = {kind: 'radio', options: []};
        groups.set(key, slot);
        slots.push(slot);
      }
      groups.get(key).options.push(field);
    } else if (field.kind === 'select') {
      if (!open(field).length) return null;
      slots.push({kind: 'select', field});
    } else if (field.kind === 'drag') {
      if (!dropTargets.length) return null;
      slots.push({kind: 'drag', field});
    } else if (['text', 'checkbox', 'point'].includes(field.kind)) slots.push({kind: field.kind, field});
    else return null;
  }
  slots.forEach((slot, index) => { slot.key = `${slot.kind === 'radio' ? 'choice' : 'blank'}_${index + 1}`; });
  return slots.length ? slots : null;
}

export function answerSlotsSchema(slots, dropTargets = []) {
  const properties = {};
  for (const slot of slots) {
    const field = slot.field;
    if (slot.kind === 'radio') properties[slot.key] = {type: 'string', enum: numbered(slot.options, option => option.label || option.context || option.id),
      description: 'Multiple choice group. Pick the one correct option.'};
    else if (slot.kind === 'select') properties[slot.key] = {type: 'string', enum: numbered(open(field), option => option.label || option.value),
      description: `Dropdown. Pick the correct choice. ${describe(field)}`};
    else if (slot.kind === 'checkbox') properties[slot.key] = {type: 'boolean', description: `Checkbox. true means check it. ${describe(field)}`};
    else if (slot.kind === 'text') properties[slot.key] = {type: 'string',
      description: `Answer box. Only the exact value to type, ${field.format === 'latex' ? 'as LaTeX without delimiters' : 'as plain text with slash fractions like 1/3'}, no "x =" unless the box needs it. ${field.choice ? 'This box belongs to one multiple-choice option; use "" unless that option is chosen. ' : ''}${describe(field)}`};
    else if (slot.kind === 'point') properties[slot.key] = {type: 'object', additionalProperties: false,
      properties: {x: {type: 'number'}, y: {type: 'number'}}, required: ['x', 'y'], description: `Graph point. ${describe(field)}`};
    else if (slot.kind === 'drag') properties[slot.key] = {type: 'string', enum: numbered(dropTargets, target => target.label || target.id),
      description: `Where this item goes. ${describe(field)}`};
  }
  return {type: 'object', additionalProperties: false, properties, required: Object.keys(properties)};
}

export function slotSolutionSchema(base, slots, dropTargets = []) {
  const {actions, ...properties} = base.properties;
  const ordered = {explanation: properties.explanation, answer: properties.answer, answers: answerSlotsSchema(slots, dropTargets)};
  for (const [key, value] of Object.entries(properties)) if (!(key in ordered)) ordered[key] = value;
  return {...base, properties: ordered, required: [...base.required.filter(key => key !== 'actions'), 'answers']};
}

export function slotsToActions(answers = {}, slots = [], dropTargets = []) {
  const actions = [], chosen = new Set();
  for (const slot of slots) {
    if (slot.kind !== 'radio') continue;
    const option = picked(answers[slot.key], slot.options);
    if (!option) continue;
    chosen.add(option.id);
    actions.push(action('radio', option.id, option.label || 'true'));
  }
  for (const slot of slots) {
    const value = answers[slot.key], field = slot.field;
    if (slot.kind === 'select') {
      const option = picked(value, open(field));
      if (option) actions.push(action('select', field.id, option.value));
    } else if (slot.kind === 'checkbox') actions.push(action('checkbox', field.id, value ? 'true' : 'false'));
    else if (slot.kind === 'text') {
      const text = String(value ?? '').trim();
      if (field.choice && !chosen.has(field.choice)) continue;
      if (text) actions.push(action('text', field.id, text));
    } else if (slot.kind === 'point' && value && Number.isFinite(value.x) && Number.isFinite(value.y))
      actions.push({...action('point', field.id, ''), x: value.x, y: value.y});
    else if (slot.kind === 'drag') {
      const target = picked(value, dropTargets);
      if (target) actions.push({...action('drag', field.id, ''), destination: target.id});
    }
  }
  return actions;
}
