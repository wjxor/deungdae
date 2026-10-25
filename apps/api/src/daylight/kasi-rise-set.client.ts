import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { externalApiError } from '../common/api-exception.js';

// 한국천문연구원 출몰시각 정보 — 지역명으로 조회 (공공데이터포털 15012688)
const BASE_URL =
  'https://apis.data.go.kr/B090041/openapi/service/RiseSetInfoService/getAreaRiseSetInfo';

/** 천문연이 이 시간 안에 답하지 않으면 실패로 본다 (ms) */
const TIMEOUT_MS = 5000;

const FAILURE_MESSAGE =
  '일출·일몰 시각을 받아 오지 못했어요. 낮/밤은 직접 바꿀 수 있어요';

export type SunTimes = { sunrise: Date; sunset: Date };

/**
 * `_type=json` 응답에서 쓰는 필드만 (2026-10-25 실제 응답 기준).
 * 날짜·지역이 틀려도 HTTP 200·`resultCode` `00`이고, 결과가 없으면 `items`가 빈 문자열이다
 */
type RiseSetBody = {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: { items?: { item?: RiseSetItem | RiseSetItem[] } | '' };
  };
};

type RiseSetItem = {
  /** 숫자로 온다 (`20261025`) */
  locdate?: unknown;
  /** `"0646  "` — HHMM 뒤에 공백. 계절과 관계없이 같은 형식 (2026-06·10·12, 2027-01·03 확인) */
  sunrise?: unknown;
  sunset?: unknown;
};

/**
 * 천문연 응답에서 그 날의 일출·일몰을 꺼낸다. 형식이 틀리거나 다른 날짜면 이유를 담아 던진다.
 * @param date 한국 날짜 `2026-10-25`
 */
export function parseRiseSet(body: unknown, date: string): SunTimes {
  const res = (body as RiseSetBody | null)?.response;
  const code = res?.header?.resultCode;
  if (code !== '00') {
    throw new Error(
      `resultCode ${String(code)} ${res?.header?.resultMsg ?? ''}`.trim(),
    );
  }
  const items = res?.body?.items;
  const item = items ? [items.item].flat()[0] : undefined;
  if (!item) throw new Error('결과 없음 (날짜·지역 이름 확인)');
  if (String(item.locdate) !== date.replaceAll('-', '')) {
    throw new Error(`요청과 다른 날짜 ${String(item.locdate)}`);
  }

  const sunrise = kstTime(date, item.sunrise);
  const sunset = kstTime(date, item.sunset);
  if (sunrise.getTime() >= sunset.getTime()) {
    throw new Error('일출이 일몰보다 늦음');
  }
  return { sunrise, sunset };
}

/**
 * 천문연 시각 값(`"0646  "`, `"064612"`)을 그 날의 한국 시각으로 바꾼다 (ERD `sun_times`: 끝 공백, HHMM·HHMMSS 혼재).
 * 공백이 없으면 JSON 변환에서 숫자가 되어 앞자리 0이 빠질 수 있어 다시 채운다 (`suntransit`이 숫자로 옴)
 */
export function kstTime(date: string, value: unknown): Date {
  const text =
    typeof value === 'number'
      ? String(value).padStart(value < 10000 ? 4 : 6, '0')
      : typeof value === 'string'
        ? value.trim()
        : '';
  const m = /^([01]\d|2[0-3])([0-5]\d)([0-5]\d)?$/.exec(text);
  if (!m) throw new Error(`시각 형식이 다름 ${JSON.stringify(value)}`);
  const [, hh, mm, ss = '00'] = m;
  return new Date(`${date}T${hh}:${mm}:${ss}+09:00`);
}

/**
 * 한국천문연구원 출몰시각 API 호출 (FR-005, API.md 1-1장).
 * 키는 서버 환경변수 `KASI_API_KEY`(공공데이터포털 서비스 키). 실패는 모두 502 EXTERNAL_API_ERROR로 바꾼다
 */
@Injectable()
export class KasiRiseSetClient {
  private readonly logger = new Logger(KasiRiseSetClient.name);
  private readonly serviceKey: string | undefined;

  constructor(config: ConfigService) {
    this.serviceKey = config.get<string>('KASI_API_KEY') || undefined;
    if (!this.serviceKey) {
      this.logger.warn(
        'KASI_API_KEY가 없어 일출·일몰 조회가 실패합니다. 저장소 루트 .env를 확인하세요',
      );
    }
  }

  /**
   * 그 날 그 지역의 일출·일몰.
   * @param date 한국 날짜 `2026-10-25`
   * @param region 천문연 지역 이름 (`대전`)
   */
  async riseSet(date: string, region: string): Promise<SunTimes> {
    if (!this.serviceKey) throw externalApiError(FAILURE_MESSAGE);

    const params = new URLSearchParams({
      serviceKey: this.serviceKey,
      location: region,
      locdate: date.replaceAll('-', ''),
      _type: 'json',
    });
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}?${params.toString()}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      // URL에 서비스 키가 들어 있어 URL은 남기지 않는다
      this.logger.warn(`천문연 출몰시각 호출 실패: ${errorText(e)}`);
      throw externalApiError(FAILURE_MESSAGE);
    }

    if (!res.ok) {
      // 키가 틀리면 403, 없으면 401 (본문은 공공데이터포털 에러 형식)
      const detail = await res.text().catch(() => '');
      this.logger.warn(
        `천문연 출몰시각 HTTP ${res.status}: ${detail.slice(0, 200)}`,
      );
      throw externalApiError(FAILURE_MESSAGE);
    }

    try {
      return parseRiseSet(await res.json(), date);
    } catch (e) {
      this.logger.warn(`천문연 출몰시각 응답 해석 실패: ${errorText(e)}`);
      throw externalApiError(FAILURE_MESSAGE);
    }
  }
}

/** 로그에 남길 에러 문장 */
function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
