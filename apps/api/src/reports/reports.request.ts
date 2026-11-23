import type { LatLng, ReportType } from '../../../../shared/types.js';
import { invalidInput, outOfArea } from '../common/api-exception.js';
import { isInDaejeonRect } from '../common/daejeon.js';
import { readLatLng } from '../common/geo.js';

/** 제보 설명 최대 글자 수. 웹 S4 입력칸의 `maxLength`와 같다 (#92 승민 임시값, 2026-11-23 PR #93에서 정함) */
export const REPORT_DESCRIPTION_MAX = 200;

/** 받는 제보 유형 (화면 S4). 우범지역(`suspicious`)은 기준이 애매하고 범죄다발구역 데이터가 없어 뺐다 (2026-11-23, PR #92) */
export const REPORT_TYPES: readonly ReportType[] = [
  'dark',
  'no_cctv',
  'others',
];

/** 검사를 마친 새 제보. 설명은 앞뒤 빈칸을 지우고, 비면 null */
export type NewReport = {
  location: LatLng;
  type: ReportType;
  description: string | null;
};

const BAD_FORMAT = '제보 형식이 올바르지 않아요';
const TOO_LONG = `설명은 ${REPORT_DESCRIPTION_MAX}자까지 쓸 수 있어요`;
const OUT_OF_AREA_MESSAGE =
  '대전 안에서만 제보할 수 있어요. 지도를 눌러 대전 안을 골라 주세요';

/**
 * `POST /reports` 본문을 검사한다 (API.md 6장 `CreateReportRequest`, FR-009).
 * 좌표·유형·설명 형식이 틀리면 400 INVALID_INPUT, 설명이 200자를 넘어도 400 INVALID_INPUT,
 * 대전 사각형 밖이면 400 OUT_OF_AREA — 점수에 반영할 구간이 없는 곳이라서
 */
export function parseCreateReportRequest(body: unknown): NewReport {
  const { location, type, description } = asRecord(body);
  const latLng = readLatLng(location);
  if (!latLng || !isReportType(type)) throw invalidInput(BAD_FORMAT);
  if (!isInDaejeonRect(latLng)) throw outOfArea(OUT_OF_AREA_MESSAGE);
  return { location: latLng, type, description: readDescription(description) };
}

/** 설명은 선택이다. 없거나 null이거나 빈칸뿐이면 null, 글자가 아니면 400, 200자를 넘으면 400 */
function readDescription(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw invalidInput(BAD_FORMAT);
  const text = value.trim();
  if (text.length > REPORT_DESCRIPTION_MAX) throw invalidInput(TOO_LONG);
  return text === '' ? null : text;
}

/** 받는 유형인지 */
function isReportType(value: unknown): value is ReportType {
  return REPORT_TYPES.includes(value as ReportType);
}

/** 객체면 그대로, 아니면 빈 객체 */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
