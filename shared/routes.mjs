export const WORD_POOL = Object.freeze([
  '대한민국', '서울특별시', '부산광역시', '인공지능', '컴퓨터', '인터넷', '스마트폰', '게임',
  '축구', '야구', '농구', '영화', '음악', '과학', '수학', '물리학', '화학', '생물학',
  '지구', '태양', '달', '우주', '은하', '자동차', '철도', '항공기', '선박', '한글',
  '한국어', '영어', '일본', '중국', '미국', '프랑스', '독일', '영국', '로마', '고대 그리스',
  '조선', '고구려', '백제', '신라', '고려', '세종대왕', '이순신', '나무', '동물', '고양이',
  '개', '호랑이', '사자', '공룡', '바다', '산', '강', '사막', '비', '눈(날씨)', '구름',
  '번개', '불', '물', '금', '철', '도시', '국가', '민주주의', '철학', '역사', '경제학',
  '심리학', '의학', '로봇', '프로그래밍 언어', 'JavaScript', 'Python', 'Apple', 'Microsoft',
  '우주 탐사', '올림픽', '월드컵', '대한민국의 역사', '세계사', '기후', '환경', '에너지',
]);

export function cleanTitle(value) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, '').replaceAll('_', ' ').trim().slice(0, 200)
    : '';
}

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function utcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function dailyRoute(dateKey = utcDateKey()) {
  const first = hashText(`start:${dateKey}`) % WORD_POOL.length;
  let second = hashText(`goal:${dateKey}`) % WORD_POOL.length;
  if (second === first) second = (second + 17) % WORD_POOL.length;
  return { mode: 'daily', dateKey, startTitle: WORD_POOL[first], goalTitle: WORD_POOL[second] };
}

export function randomRoute(random = Math.random) {
  const first = Math.floor(random() * WORD_POOL.length) % WORD_POOL.length;
  let second = Math.floor(random() * WORD_POOL.length) % WORD_POOL.length;
  if (second === first) second = (second + 1) % WORD_POOL.length;
  return { mode: 'random', dateKey: null, startTitle: WORD_POOL[first], goalTitle: WORD_POOL[second] };
}

export function customRoute(startValue, goalValue) {
  const startTitle = cleanTitle(startValue);
  const goalTitle = cleanTitle(goalValue);
  if (!startTitle || !goalTitle) throw new Error('출발 문서와 목표 문서를 모두 입력해 주세요.');
  if (startTitle === goalTitle) throw new Error('출발 문서와 목표 문서는 서로 달라야 해요.');
  return { mode: 'custom', dateKey: null, startTitle, goalTitle };
}
