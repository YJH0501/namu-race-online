// Server/maintainer data only. Neither renderer imports this catalog.
import catalog from '../server/data/hint-cards.json' with { type: 'json' };

const cards = new Map(catalog.cards.map(card => [card.title, Object.freeze({ ...card,
  categories: Object.freeze([...card.categories]), relatedTitles: Object.freeze([...card.relatedTitles]) })]));
export const HINT_GOAL_TITLES = Object.freeze([...cards.keys()]);
export const HINT_CATALOG_VERSION = catalog.version;
export function getHintCard(title) { return cards.get(title) || null; }
