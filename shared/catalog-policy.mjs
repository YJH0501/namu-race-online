import {cleanTitle} from './routes.mjs';

// Match both released clients' title handling without silently changing a real title.
export function isCompatibleCatalogTitle(title) {
  return typeof title === 'string' && title.length > 0 && cleanTitle(title) === title
    && !/^(?:분류|파일|틀|사용자|나무위키|휴지통|더미|위키운영|토론):/i.test(title)
    && !['.', '..'].includes(title);
}
