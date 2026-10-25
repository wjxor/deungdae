/**
 * 천문연 출몰시각 실제 응답 (2026-10-25, `location=대전`, `_type=json`).
 * 시각 값 끝에 공백이 있고, 공백이 없는 `suntransit`·`locdate`는 숫자로 온다
 */
export const RISE_SET_20261025 = {
  response: {
    header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
    body: {
      items: {
        item: {
          aste: '1909  ',
          astm: '0520  ',
          civile: '1809  ',
          civilm: '0620  ',
          latitude: 3621,
          latitudeNum: '36.3500000',
          location: '대전',
          locdate: 20261025,
          longitude: 12723,
          longitudeNum: '127.3833330',
          moonrise: '1651  ',
          moonset: '0529  ',
          moontransit: '2340  ',
          naute: '1839  ',
          nautm: '0550  ',
          sunrise: '0646  ',
          sunset: '1742  ',
          suntransit: 121435,
        },
      },
      numOfRows: 10,
      pageNo: 1,
      totalCount: 1,
    },
  },
};

/** 날짜·지역 이름이 틀렸을 때 실제 응답 — HTTP 200·`00`인데 `items`가 빈 문자열 */
export const RISE_SET_EMPTY = {
  response: {
    header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
    body: { items: '', numOfRows: 10, pageNo: 1, totalCount: 0 },
  },
};

/** 위 응답의 일출·일몰 (한국 시간) */
export const SUNRISE_20261025 = new Date('2026-10-25T06:46:00+09:00');
export const SUNSET_20261025 = new Date('2026-10-25T17:42:00+09:00');
