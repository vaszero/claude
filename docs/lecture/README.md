# 연세일등정형외과 CS 강의 — 인수인계 및 채팅용 프롬프트

**다운로드**: [PPT](yonsei-ildeung-cs-20261117.pptx) · [발표자 노트](speaker-notes.md) · [입장 QR 카드](join-qr-card.png)

> 공개용 문서입니다. 진행자 비밀번호와 병원 모니터링 결과는 넣지 않았습니다 (별도 전달).

---

## 1. 지금까지 만든 것

### 강의
| 항목 | 내용 |
|---|---|
| 강의명 | **우리는 병원의 얼굴입니다** — CS 기초 과정 |
| 병원 | 연세일등정형외과의원 (시흥) |
| 일시 | 2026년 11월 17일 · 60분 |
| 강사 | 정경 (VASZERO Consulting 대표) |
| PPT 파일 | `yonsei-ildeung-cs-20261117.pptx` (26장 + 강사용 숨김 1장) |
| 발표자 노트 | `speaker-notes.md` (Canva로 옮기면 노트가 사라지므로 따로 보관) |

### 게임 (CS 플레이)
| 항목 | 주소 / 값 |
|---|---|
| **직원 입장 (QR)** | https://ildeung-cs-play.higgsfield.app |
| **강사 화면** | https://ildeung-cs-play.higgsfield.app/host |
| **진행자 비밀번호** | 별도 전달 (공개 문서에 적지 않음) |
| 호스팅 | 대표님 Higgsfield 계정 (공개 게시됨, 커뮤니티 목록 이름: "CS 플레이 — 병원 CS 교육 게임") |
| 코드 보관 | GitHub `vaszero/claude` (브랜치 `claude/awesome-meitner-62jgbg`, 공개 저장소 · 비밀번호는 저장 안 함) |
| 기타 파일 | 입장 QR 안내 카드 `join-qr-card.png`, 플레이 영상 `qr/whack-demo.mp4` |

### PPT 버튼 링크 (Canva로 옮긴 뒤 반드시 이대로 다시 확인)
| 슬라이드 | 버튼 글자 | 링크 |
|---|---|---|
| 2 | 강사 화면 열기 | https://ildeung-cs-play.higgsfield.app/host#lobby |
| 3 | 사전 퀴즈 열기 | https://ildeung-cs-play.higgsfield.app/host#quiz |
| 4 | 워드클라우드 열기 | https://ildeung-cs-play.higgsfield.app/host#cloud |
| 14 | 멘트 투표 열기 | https://ildeung-cs-play.higgsfield.app/host#vote |
| 15 | 두더지 게임 열기 | https://ildeung-cs-play.higgsfield.app/host#whack |
| 22 | OX 퀴즈 열기 | https://ildeung-cs-play.higgsfield.app/host#ox |
| 23 | 워드클라우드 열기 | https://ildeung-cs-play.higgsfield.app/host#cloud |
| 24 | 사후 퀴즈 열기 | https://ildeung-cs-play.higgsfield.app/host#quiz |
| 25 | 결과 리포트 열기 | https://ildeung-cs-play.higgsfield.app/host#report |

- 링크 끝의 `#quiz`, `#vote` 등은 강사 화면을 **그 게임으로 바로 여는 장치**입니다. 꼭 붙어 있어야 합니다.
- 2번과 게임 슬라이드에 들어간 **QR 이미지**는 직원 입장 주소(https://ildeung-cs-play.higgsfield.app)입니다.

### 강의 구성 (60분)
| 시간 | 구간 | 슬라이드 |
|---|---|---|
| 0~14분 | 도입 | 1 표지 · 2 입장 · 3 사전 퀴즈 · 4 워드클라우드 "내가 환자로 갔을 때 서운했던 순간" · 5 강사 소개 · 6 [영상] 오프닝 |
| 14~35분 | 1부 CS 기초 5가지 | 7 섹션 · 8 기초 5가지 · 9 첫 3초 · 10 집중(휴대폰) · 11 설명 · 12 말투(쿠션 언어) · 13 존중(몸과 옷) · 14 멘트 투표 · 15 두더지 게임 |
| 35~45분 | 2부 파트별 체크포인트 | 16 섹션 · 17 파트별 이렇게/조심 · 18 같은 뜻 다른 말 · 19 역할극 · 20 [영상] 응대 사례 |
| 45~53분 | 3부 불편한 순간·실천 | 21 화난 환자 + 직원 보호 · 22 부서 대항 OX(5문제) · 23 실천 한 문장 |
| 53~60분 | 마무리 | 24 사후 퀴즈 · 25 결과 리포트 · 26 우리는 병원의 얼굴입니다 |
| — | 숨김 | 27 강사용 진행 가이드 (Canva에서는 삭제 권장) |

### 지켜야 할 원칙
- 강의는 특정 사례나 특정 직원을 언급하지 않고, 모든 내용을 **"CS 기초 과정의 기본 수칙"**으로만 다룬다.
- 특정 직원을 떠올리게 하는 표현은 쓰지 않는다.
- 이 병원 직원이 나오는 영상·사진은 쓰지 않는다.
- 병원 내부 점검 결과는 원장님께 **별도 보고서**로 전달한다.

---

## 2. 채팅창에 붙여 넣을 프롬프트

> 아래 상자 안 내용을 그대로 복사해서 Claude 채팅창에 붙여 넣고, **PPT 파일(`yonsei-ildeung-cs-20261117.pptx`)을 함께 첨부**하세요.

```
첨부한 PPT(yonsei-ildeung-cs-20261117.pptx)는 11월 17일 연세일등정형외과(시흥)에서 할 1시간 CS 강의안이야.
제목은 "우리는 병원의 얼굴입니다 — CS 기초 과정"이고, 강사는 나(정경, VASZERO Consulting 대표).

[해 줄 일]
1. 이 PPT를 내 Canva로 가져와서(Canva 커넥터) 편집할 수 있는 프레젠테이션으로 만들어 줘.
2. 배경과 디자인을 더 세련되게 다듬고 싶어. 지금 스타일(흰 배경, 남색·파랑·노랑, 점 9개 장식, 둥근 카드)을 기본으로 유지하되 배경을 바꿔 보고 싶어. 시안을 먼저 보여 줘.
3. 내용(문구)은 바꾸지 마. 디자인만 손봐.

[꼭 지켜야 할 것]
- 슬라이드의 파란 버튼 9개는 강의 중 게임 화면을 여는 링크야. Canva로 옮긴 뒤 아래 링크가 버튼에 그대로 걸려 있는지 확인하고, 빠졌으면 다시 걸어 줘.
  · 2번 "강사 화면 열기" → https://ildeung-cs-play.higgsfield.app/host#lobby
  · 3번 "사전 퀴즈 열기" → https://ildeung-cs-play.higgsfield.app/host#quiz
  · 4번 "워드클라우드 열기" → https://ildeung-cs-play.higgsfield.app/host#cloud
  · 14번 "멘트 투표 열기" → https://ildeung-cs-play.higgsfield.app/host#vote
  · 15번 "두더지 게임 열기" → https://ildeung-cs-play.higgsfield.app/host#whack
  · 22번 "OX 퀴즈 열기" → https://ildeung-cs-play.higgsfield.app/host#ox
  · 23번 "워드클라우드 열기" → https://ildeung-cs-play.higgsfield.app/host#cloud
  · 24번 "사후 퀴즈 열기" → https://ildeung-cs-play.higgsfield.app/host#quiz
  · 25번 "결과 리포트 열기" → https://ildeung-cs-play.higgsfield.app/host#report
  (링크 끝의 #quiz 같은 부분까지 꼭 그대로)
- QR 이미지(직원 입장용, https://ildeung-cs-play.higgsfield.app)는 지우거나 가리지 마. 크기를 줄이지도 마.
- 병원 로고(표지 왼쪽 위)는 그대로 둬.
- 6번, 20번은 내가 영상을 넣을 자리야. 점선 틀은 그대로 둬.
- 27번(강사용 진행 가이드)은 삭제해 줘.
- 발표자 노트는 Canva로 넘어가지 않으니 따로 챙길게. 노트는 신경 쓰지 않아도 돼.
- 글꼴은 한글이 깨지지 않는 글꼴로(예: Pretendard 또는 Noto Sans KR). 프로젝터에서 잘 보이게 본문 14pt 이상 유지.

[다 끝나면]
- Canva 편집 링크를 줘.
- 버튼 9개 링크를 하나씩 확인한 결과를 표로 보여 줘.
```

---

## 3. 강의 당일 체크리스트
1. **강의 30분 전**: 노트북에서 강사 화면(https://ildeung-cs-play.higgsfield.app/host) 열기 → 진행자 비밀번호 입력 → **[세션 초기화]**
2. 휴대폰 1대로 입장해 보고 다시 **[세션 초기화]**
3. **직원들이 들어오는 동안** 2번 입장 QR 화면을 띄워 미리 입장시키기
4. 시간이 밀리면 줄이는 순서: 영상 하나 빼기 → 역할극 1조만 시연 → OX 3문제 → 실천 한 문장은 말로
5. **강의 후**: 25번 결과 리포트 → **[CSV 다운로드]**와 **[인쇄 · PDF 저장]** (원장님 보고서용)

### 원장님과 미리 맞출 것
- 개인 휴대폰 규칙 (보관 위치, 업무용 예외)
- 폭언·반복 항의 때 실장님 호출 기준
- 병원 점검 결과 보고서 전달 (강의와 별도)

### 게임 내용을 바꾸고 싶을 때
게임의 문제·멘트 수정은 채팅이 아니라 이 작업 환경(Claude Code)에서 해야 합니다. 문제 파일 위치: GitHub `vaszero/claude` 저장소의 `content/yonsei-ildeung-siheung.json` → 반영 후 Higgsfield에 다시 배포.
