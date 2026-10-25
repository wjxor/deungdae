import { Injectable, Logger } from '@nestjs/common';
import type {
  FacilitiesResponse,
  Facility,
  FacilityType,
} from '../../../../shared/types.js';
import { externalApiError } from '../common/api-exception.js';
import { dbErrorText } from '../common/db-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Bbox } from './facilities.query.js';

/** `$queryRaw` 한 행. 위치는 geography라 위도·경도로 풀어서 받는다 */
type FacilityRow = { id: number; type: FacilityType; lat: number; lng: number };

const DB_ERROR_MESSAGE =
  '안전시설 정보를 잠시 불러오지 못했어요. 잠시 후 다시 시도해 주세요';

@Injectable()
export class FacilitiesService {
  private readonly logger = new Logger(FacilitiesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 지도 범위 안의 CCTV·안심벨·지구대 (API.md 4장, FR-002).
   * 가로등·보안등은 합쳐 7만 개가 넘어 지도에 띄우지 않고 안전점수에만 쓴다.
   * DB가 없거나 실패하면 502 EXTERNAL_API_ERROR
   */
  async findInBbox({ sw, ne }: Bbox): Promise<FacilitiesResponse> {
    if (!this.prisma.configured) throw externalApiError(DB_ERROR_MESSAGE);

    let rows: FacilityRow[];
    try {
      // location의 GIST 인덱스를 쓰도록 geography끼리 비교한다. 남·북 변이 위도선이 아니라 대원이라
      // 생기는 차이는 4km 범위에서 0.3m보다 작다 (2026-10-25 각 변 0.3m 안·밖 점, 정제 데이터 203개 범위로 확인)
      rows = await this.prisma.$queryRaw<FacilityRow[]>`
        SELECT id, type,
               ST_Y(location::geometry) AS lat,
               ST_X(location::geometry) AS lng
        FROM facilities
        WHERE type IN ('cctv', 'emergency_bell', 'police')
          AND ST_Intersects(
                location,
                ST_MakeEnvelope(${sw.lng}::float8, ${sw.lat}::float8, ${ne.lng}::float8, ${ne.lat}::float8, 4326)::geography
              )
        ORDER BY id`;
    } catch (e) {
      // 지도 범위는 사용자 위치 근처라 로그에 남기지 않는다
      this.logger.warn(`시설 조회 실패: ${dbErrorText(e)}`);
      throw externalApiError(DB_ERROR_MESSAGE);
    }
    return { facilities: rows.map(toFacility) };
  }
}

/** DB 행 → API 응답의 `Facility` */
function toFacility(row: FacilityRow): Facility {
  return {
    id: row.id,
    type: row.type,
    location: { lat: row.lat, lng: row.lng },
  };
}
