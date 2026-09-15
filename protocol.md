# R300 ↔ micro:bit UART Protocol v2

> 呢份係 `microbit_R300`（micro:bit extension，`r300.ts`／`protocol.ts`）同 `CompanionRobots`（R300 firmware，`aimo-v1-edu-microbit` board：`microbit_command_router.h`／`microbit_link.h`）之間**唯一嘅合約**。兩邊實作有衝突，以呢份為準；要改 wire format，先改呢份再改 code。
>
> **狀態**：v2（2026-09-15）。**兩邊都全部實作並上機驗證**（handshake＋`live`＋全部 ops；R300 側 `microbit_command_router.h` 全家、micro:bit 側 `protocol.ts`／`r300.ts`）。修咗 Y103（R300 聽到自己 echo 而假死）同「`handshake refused` 之後死等 reboot」兩單。
> ⚠️ **v1 × v2 唔准混跑**：兩個 repo 要**一齊 flash**。舊 micro:bit 對 v2 `hello` 會回 `badver`，R300 會**每 1 秒重試直到對面升級**（唔會死等 reboot）。
> ⚠️ **v2 改咗啲乜**：加 `"s"` sender tag（收方丟棄自己 tag 嘅行）；`v` 淨係 handshake 嘅行先帶；`id` 兩邊都 0–99；`t` 變單字 `r`／`a`／`f`；payload key 縮到 ≤2 字（`ex`／`id`／`rt`／`em`／`vl`／`ro`／`fd`）；行長上限 127 → **253**；micro:bit serial buffer 128 → **254**。
> ⚠️ **v0**（`{"MB_cmd":"test"}`／`{"MicroBit":…}`／`{"cmd":"control_motor"}`）同 v1／v2 **互不相容**。

## 1. 物理層

| 項目 | 值 |
|---|---|
| 介面 | UART，115200 baud，8N1 |
| 接線 | micro:bit **P0 (TX) → R300 GPIO21 (RX)**；micro:bit **P1 (RX) ← R300 GPIO10 (TX)**；**必須共地** |
| R300 側 | `UART_NUM_0`（`MicrobitLink`），RX line buffer 254 bytes（`char buf[254]`） |
| micro:bit 側 | `serial.redirect(P0, P1, 115200)` 之後**必須**即刻 `serial.setRxBufferSize(254)` + `serial.setTxBufferSize(254)`（254 係 MakeCode 文檔寫嘅上限，256 唔得） |

⚠️ micro:bit 預設 serial buffer 得 **20 bytes**，呢個 protocol 最短嗰句都超過 50 bytes。唔加大嘅話 ring buffer 喺 `\n` 到之前已經捲咗，症狀係**完全冧聲**，同條線冇駁一模一樣。

## 2. Framing

- 每條訊息 = **一個 JSON object + 一個 `\n`**。發送方只用 `\n`；收方將 `\n` 同 `\r` 都當行尾。
- **只准 ASCII**。checksum 係 byte 加總，而 micro:bit 用 `charCodeAt()` 計——只有 ASCII 下兩邊保證一樣。
- **唔准有空白**。
- **每行最多 253 bytes（唔計 `\n`）**。R300 個 line buffer 係 `char buf[254]`，超長嘅行會**成行靜靜哋丟棄，冇 log、冇 ack**——所以發送方一定要自己保證唔超。實際最長嘅行（`mcp_desc` 名 16＋desc 34）得 **127 bytes**，全部有位。

## 3. Envelope

```json
{"v":2,"s":"r300","id":3,"t":"r","op":"hello","p":{"fw":"1.0.0"},"ck":129}
```

| 欄位 | 型別 | 意思 |
|---|---|---|
| `v` | int | Protocol 版本，而家係 `2`。**淨係 handshake 嘅行帶**（`hello` 嘅 req／ack 同 `badver` 嘅 ack）；收方「有就必須等於自己個版本，冇就當同版本」。唔係 firmware 版本（版本字串喺 `hello` 交換，見 9.2） |
| `s` | string | **Sender tag**：`"r300"` 或 `"mb"`。收方**最優先**檢查（第 7 節 #0）：等於自己 tag = 自己嘅 TX 被 RX 聽返（浮空線／echo），即刻丟棄 |
| `id` | int | 關聯 ID（第 5 節）。`ack`／`fin` 原封 echo 返 `req` 嗰個 |
| `t` | string | 邊一段：`"r"`（req）／`"a"`（ack）／`"f"`（fin） |
| `op` | string | 種類（第 9 節）。`ack`／`fin` echo 返 `req` 嗰個 |
| `p` | object | Payload，形狀跟 `op` 同 `t` 變。**冇內容都要寫 `{}`** |
| `ck` | int | 校驗碼（第 4 節）。**一定係最後一個欄位** |

發送方**必須**照 `v?, s, id, t, op, p, ck` 次序輸出（`v` 只有 handshake 嘅行先有）。收方**只可以**依賴 `ck` 係最後一個欄位，其餘次序唔可以假設。

⚠️ **`v`、`id`、`t`、`op`、`p.st`、`p.e` 嘅意思同第 4 節嘅 `ck` 規則，喺將來所有版本都唔准改。** 咁唔同版本之間先講得出「版本唔夾」（第 7 節 #3 例外）。

⚠️ **`s` 係 v2 加嘅，佢修嘅係 Y103**：R300 嘅 RX 一浮空，就會將自己 TX 出去嘅嗰條線聽返嚟（連 `live` req 都原句彈返），舊版當咗佢係「micro:bit 嘅回覆」，個 handshake 就咁被判死。收方**最優先**丟棄自己 tag 嘅行之後，自己嘅 echo 永遠入唔到嚟（第 7 節 #0）。冇 `s` 嘅行（或者唔係自己 tag）照正常處理。

## 4. `ck` 點計

演算法：**全部 byte 加埋 mod 256**。

**發送方**
1. 砌好冇 `ck` 嘅完整 object，例如 `{"v":2,"s":"r300","id":3,"t":"r","op":"hello","p":{"fw":"1.0.0"}}`
2. 對成條 string 計 checksum
3. 喺最後嗰個 `}` 前面插 `,"ck":N`
4. 加 `\n` 送出

**收方**
1. 喺成條 line 搵**最後一個** `,"ck":`
2. 讀佢後面嘅整數
3. 由嗰個位置剷到尾，補返一個 `}`
4. 對呢條 string 重新計，同讀到嘅數比較

點解咁設計：
- **對收到嘅 bytes 計，唔係對 parse 完再砌返出嚟嘅值計。** 兩邊唔使就 float 點印、key 次序、escape 方式達成共識。
- **搵「最後一個」**：payload 入面就算有 `,"ck":` 呢串字，真正嘅 `ck` 一定喺最尾。

⚠️ 8-bit checksum 有 1/256 機會撞。而家冇數值型回覆，夠用；將來加 `*_get` 攞真數值時要升 16-bit（即係升 `v`）。

## 5. `id`

| 發起方 | 範圍 |
|---|---|
| micro:bit | **0–99** |
| R300 | **0–99** |

- 兩邊**各自**喺 0–99 遞增、循環；邊個發起**唔再**靠範圍分（v2 起兩邊一樣），所以去重要 `id`＋`op` 一齊比（第 7.2 節）。
- **重試用返同一個 `id`**（第 8 節）。
- 解析器照收 `id` 0–255（v1 嘅界）—— 0–99 係發送方自己嘅約束，唔係收方嘅拒收線。
- 去重記錄幾時清，見第 7.2 節 —— **R300 收到 `hello` 嘅 ack 之後清自己嘅**。micro:bit 唔去重，所以佢冇嘢要清。

## 6. 三段：`r` → `a` → `f`

```
發起方 ──r──→ 對方
發起方 ←──a── 對方      對方收到 r 之後回
發起方 ──f──→ 對方      發起方收到「最終」a 之後回
```

- **邊個發 `r`，邊個負責發 `f`。** `f` 個 `p` 係 `{"rt":N}`，N = 由**最後一次**發出 `r` 到收到 `a` 嘅毫秒數。
- **最終 ack** = `st:"ok"`，或者一個**唔會重試**嘅錯誤（第 7.1 節）。收到會重試嘅錯誤（`badck`）或者超時就**唔發 `fin`**。
- 重試用晒都冇收到 ack → **唔發 `fin`**。
- 🔴 **任何人都唔准回覆 `ack` 或者 `fin`。** 回覆一個 ack 會觸發對方再回覆，兩塊板會 ping-pong 到永遠。

## 7. 收方處理次序

收到一行，**照呢個次序**檢查：

| # | 檢查 | 唔通過點做 |
|---|---|---|
| 0 | **`s` 唔係自己 tag** | **丟，唔回覆**，亦唔計 traffic。等於自己 tag = 自己 TX 嘅 echo（第 3 節） |
| 1 | Parse 到 JSON，而且係有內容嘅 object | **丟，唔回覆** |
| 2 | `ck` 存在而且啱（後面**只准**跟最後一個 `}`——多咗任何 byte，連空白都算唔啱） | `,"ck":` **完全唔存在** → **丟，唔回覆**（呢條唔係本 protocol 出嘅行）；`ck` 唔啱但 `t`=`"r"`、`id` 係 0–255 整數、`op` 係合法 token → 回 `{"st":"err","e":"badck"}`；`t`／`id`／`op` 任何一樣讀唔到 → **丟，唔回覆** |
| 3 | `v`（**如果有帶**）等於自己嘅版本 | `t`=`"r"` → 回 `{"st":"err","e":"badver"}`，**個 ack 要帶自己嘅 `v`**；其他 → **丟**，但 **log 一定要印出對方個 `v`**。**例外**：`t`=`"a"`、`p.e`=`"badver"`，而且 `id`／`op` 對得上自己等緊嘅 req → **照讀**，當收到 `badver`（對方個 ack 用緊佢自己個 `v`，唔開例外就永遠讀唔到） |
| 4 | 按 `t` 分派 | 見下 |

**`t:"r"`**
1. `id` 同 `op` 都等於上一個處理過嘅 `req` → **唔再執行**，重播上次個 `ack`（第 7.2 節）
2. 唔識個 `op` → 回 `{"st":"err","e":"noop"}`
3. `p` 內容唔啱 → 回 `{"st":"err","e":"badarg"}`
4. 執行，回 `{"st":"ok"}`（或者該 op 指定嘅 ack payload）

（原本呢度仲有一步「未 handshake 就回 `nohs`」——R300 主導 handshake 之後取消咗：R300 未 handshake 之前根本唔會發任何其他 `req`。）

**`t:"a"`**：`id` **同** `op` 都等於自己而家等緊嘅 `req` → 接受；否則 → **丟**，計一次 stale。

**`t:"f"`**：記錄就得，**唔回覆**。

🔴 **「收到一條合法訊息」= 通過咗 #0–#3。** 任何「對方仲生存」嘅判斷（第 9.1 節 idle-skip）都**只可以**計通過 `ck` 嘅行——**自己嘅 echo 就係喺 #0 度擋住，所以 RX 浮空嗰陣唔會假裝成「有人答緊」。**

### 7.1 錯誤碼

| `e` | 意思 | 發送方點做 |
|---|---|---|
| `badck` | 校驗碼唔啱，傳輸途中爛咗 | ✅ 用同一個 `id` 重試 |
| `badver` | Protocol 版本唔夾 | 普通 `send()` 嘅 req：❌ 重試無用，回報俾學生。**`hello` 例外（第 8 節）：R300 唔停手，每 1 秒重試直到對面升級** |
| `noop` | 收方唔識呢個 `op` | ❌ |
| `badarg` | `p` 內容唔啱（缺欄位、超範圍） | ❌ 重送一萬次都係同一結果 |
| `busy` | 收方暫時唔接受（Phase 4 緊急停機先會出現） | ❌ |

### 7.2 去重（收 `req` 嗰邊）

收方記住**上一個處理過嘅 `req` 嘅 `id` 同 `op`**，同埋**當時回嘅 `ack` 原文**。`id` 同 `op` 都一樣 → 直接重播嗰句 ack，**唔重新執行**。

- **點解要去重**：`ack` 途中爛咗，發送方會用同一個 `id` 重送。收方如果再執行，`leg_set {"fd":100,"ms":1000}` 就會令部車行 **2 秒**而唔係 1 秒。
- **點解要比埋 `op`**：`id` 會重用（繞完 100 個返 0）。
- **Session 由 R300 收到 `hello` 嘅 ack 劃分**：R300 一收到就**清空自己嘅去重記錄**。micro:bit 唔去重（佢唔 cache 回覆），所以佢冇嘢要清。
- ✅ **反方向（micro:bit 自己 reset）已經補好**：micro:bit 每次開機隨機抽一個 id（**1..99**），**每個 `live` ack 都帶住佢**（第 9.1 節）。R300 見到佢同上次唔同 = 對面換咗一個 session → 即刻行返 handshake 階段，連帶清去重記錄。**呢個係佢唯一嘅用途**，唔係身分認證。
  - 冇帶嘅 live ack → R300 當「未知」，**唔會**觸發。
  - 兩次開機抽到同一個值嘅機率係 **1/99（~1%）**，後果係該次 reset 冇被偵測到（要等真斷線先 re-handshake），唔係錯誤行為。⚠️ v1 嗰陣係 1/65535；縮到 1..99 係為咗行短啲而接受嘅代價。
- ⚠️ **`live` 呢個 op 本身唔 cache**（第 7.2 節最後一條），所以佢答乜嘢唔受去重影響。
- **只有真正執行過嘅回覆先寫入去重記錄。** `badck`／`badver`／`noop`／`badarg` 呢啲喺執行之前就擋咗嘅錯誤**唔可以**記——否則同一個 `id` 嘅正確重送會永遠只收到重播嘅錯誤。
- **冪等嘅 op（`live`）可以唔 cache**，直接再答一次，出嚟嘅 ack 一模一樣。

## 8. 發送方規則

| 項目 | 值 |
|---|---|
| 等 `ack` 超時 | **500ms**（`hello` 例外：300ms —— 佢本身 500ms 就重試一次，唔想一個週期等兩次） |
| 重試 | 超時或 `badck` → **用同一個 `id`** 重送，最多 **2 次**（合共 3 次）。`hello` 例外，見下 |
| 同時喺線上嘅 `req` | **每個方向一個**，其餘排隊 |
| 收到對方嘅 `req` | **即刻回 `ack`，唔可以排隊**——排隊會令 `live` 被自己嘅指令塞住，變假斷線 |

**R300 額外規則（handshake，主導方）**
- 開機第一件事：**每 500ms 發一次 `hello`**，冇上限，直到收到 ack。
- 🔴 **收到 `hello` 嘅 ack 之前，唔會發任何其他 `req`** —— 所以銜接期線上只會有 `hello`（同成功之後一條 `fin`）。`live` 亦係等 handshake 成功先開始。
- 收到 ack（`st:"ok"`）→ log 對方個 `ex` → **清空自己嘅去重記錄** → 發 `f`（帶 `rt`）→ 開始 `live`。
- 收到 `badver` → **唔停手**：log 一次（帶 `e`），之後**每 1 秒**重試一次（慢拍每 30 秒再 log），直到對面修好。修好嗰刻自動接返，**唔使 reboot**（真 refusal 嘅成因全部係「另一邊仲係舊版」，佢升級就應該自己康復）。

**micro:bit 額外規則（回應方）**
- `connect()` 之後**唔使主動發任何嘢**（包括 `hello`）——R300 會自己嚟問。
- 收到 `hello` req 即刻回 ack，`p` 帶自己嘅 `ex`（同 `pxt.json` 個 `version` 一致）。
- Phase 1 佢**完全被動**：冇 sender、冇 `id` 分配、冇 retry、冇 queue。
- （Phase 2 之後佢開始發 `req` 嗰陣，上面張表同「每個方向一個 in-flight」就一樣適用。）

## 9. Ops

### 9.1 `live` —— R300 → micro:bit

R300 用嚟知道 micro:bit 仲連唔連住。

```
① R300 → {"s":"r300","id":5,"t":"r","op":"live","p":{},"ck":65}
② mb   → {"s":"mb","id":5,"t":"a","op":"live","p":{"st":"ok","id":42},"ck":90}
③ R300 → {"s":"r300","id":5,"t":"f","op":"live","p":{"rt":8},"ck":209}
```

| 項目 | 值 |
|---|---|
| 幾時開始 | **`hello` handshake 成功之後先開始**（見 9.2）。未 handshake 之前 R300 一條 `live` 都唔會發 |
| 週期 | **500ms** |
| 等 ack | **300ms**（一定要細過週期） |
| 判斷斷線 | **連續 2 次**冇 ack → `LOST`；**一次成功即清零**。⚠️ 門檻低 = 恢復快但容易誤報；連線抖動亦算在內，因為重新握手會清去重記錄，狀態重新對齊本身有價值 |
| Idle-skip | 過去 500ms 內收過任何**通過 tag／`ck`／`v` 檢查、而且唔係 `live`** 嘅訊息 → 今個週期唔發，當成功 |
| 斷線後果 | **重新入 handshake 階段**（第 9.2 節）＋ log warning。唔停其他嘢 |
| 對面 reset | **ack 嘅 `id` 值一變**就當同一次 reset 處理（見下），唔使等斷線 |
| 統計 | 每 30 秒一行 `stats:`，**再加每個 session 結束（`LOST`／偵測到 `id` 變）都印一次**（ok／miss／skip／late／stale／lost／restart／max_recovered_streak／rtt_max）。⚠️ 一個 session 通常短過 30 秒，所以唔加後面嗰個嘅話一行都出唔到 |

- ⚠️ **`live` 唔用第 8 節嘅重試**，用連續失敗計數。
- 🔴 **`live` ack 嘅 `id`（payload 入面嗰個）係「載住對方自己知、R300 估唔到」嘅第二個值**（第一個係 `hello` ack 嘅 `ex`）。佢補嘅係**反方向缺口**：R300 唔會再問 `hello`，所以 micro:bit 自己 reset 佢係察覺唔到嘅 —— 而 reset 之後 micro:bit 由 `id` 0 重新數，第一句隨時撞正 R300 去重記錄入面嘅那句，變成**唔執行、但回 `ok`**（第 7.2 節）。個值一變就即刻 re-handshake，順手清埋個記錄。
- ⚠️ **呢個 `id` 只會喺 `st:"ok"` 嘅 ack 出現。** `badck` 同 `badver` 係 envelope 層擋落嚟嘅，根本未入到 op dispatch，所以永遠唔帶佢 —— R300 兩者都當「冇」處理。
- ⚠️ **R300 每次開始新 session（即每次 handshake 成功）都會清走嗰個基準值。** 所以一個「慢到先報 `LOST` 再 handshake」嘅 reset 唔會白行多一轉 handshake —— 新 session 嘅第一條 ack 一律當「未知」。快嗰條路（冇 `LOST`）照樣捉得到。
- ⚠️ **個值唔可以當身分認證**：佢係明文、順序可預測（`live` 週期），同上一個完全一樣都唔會有人理。佢淨係用嚟判「換咗 session 未」。
- ⚠️ **`live` 自己嘅 ack 唔計入 idle-skip**，否則 `live` 會 skip 自己，實際變 1Hz。
- 只有 ② 影響 R300 嘅判斷；③ 係俾 micro:bit 知道自己把聲去到 R300。
- ⚠️ 呢個係**主動 probe**，即係之前因為串擾（假 `LOST`）而拆走嘅嗰類機制 —— `stats:` 就係用嚟量度真實失敗率、再決定門檻嘅依據。
- ⚠️ **版本唔夾時，R300 讀唔到對方個 `badver`**（對方 ack 用緊佢自己個 `v`，會被丟）→ 第 7 節 #3 嘅例外就係為咗處理呢個情況（`t:"a"` + `p.e:"badver"` + `id`／`op` 對得上等緊嗰個 req → 照讀）。R300 側已經實作。

### 9.2 `hello` —— R300 → micro:bit（handshake，**已實作**）

R300 主動：開機之後每 500ms 發一次，直到 micro:bit 答。Session 由呢一步劃分，版本亦係喺呢一步交換。

```
① R300 → {"v":2,"s":"r300","id":3,"t":"r","op":"hello","p":{"fw":"1.0.0"},"ck":129}
② mb   → {"v":2,"s":"mb","id":3,"t":"a","op":"hello","p":{"st":"ok","ex":"0.1.0"},"ck":233}
③ R300 → {"s":"r300","id":3,"t":"f","op":"hello","p":{"rt":11},"ck":93}
```

- `fw`：R300 firmware 版本，只准 `[A-Za-z0-9._+-]`、最多 23 字。**唔係 `v`**：`fw` 每次 release 都變，`v` 只喺 wire format 破格先變。micro:bit 收到可以只 log 低（Phase 5 個版本 block 會讀）。
- `ex`：micro:bit extension 版本（同 `pxt.json` 個 `version` 一致）。**R300 收到會 log 出嚟** —— 呢個係 ack 唯一「載住對方自己知、R300 估唔到」嘅值，所以 R300 讀得到就證明①真係到咗、而且對面真係答得出（唔止係電線通）。
- `ex` 建議保持 **23 字之內**（同 `fw` 對稱）—— ⚠️ R300 **唔會**截短或者拒收，純粹係留位：23 字嘅 `ex` 令呢句去到約 **101 bytes**（唔計 `\n`），遠低於 253。
- R300 收到 ack 之後：**清空自己嘅去重記錄** → 發 `fin` → 開始 `live`。
- ⚠️ **R300 每一次開機都會重新問一次**，唔理 micro:bit 覚唔覚得自己 handshake 過。所以 R300 reboot 唔需要 micro:bit 做任何嘢 —— 舊設計嗰兩個機制（`live` 帶 `p.hs:0`、未 handshake 回 `nohs`）**已經取消**。
- ✅ **反方向有解**：micro:bit 自己 reset／換咗另一隻 → 佢個新 `id` 值令 R300 喺下一個 `live` ack 發覺，自動重新 handshake（第 9.1／7.2 節）。R300 仍然唔會主動再問 `hello`，但唔再需要問。
- ⚠️ **micro:bit 要靠「係唔係自己 handshake 嘅第一條 `hello`」嚟分 session**：R300 一收到 ack 就會離開 handshake phase，所以**已經 ack 過一次之後再收到 `hello`，就必定係一個新 session**（R300 reboot，或者佢 `live` 判斷斷線交返手）。唔可以靠「有冇 `live` 過」—— R300 開咗 session 但未及發第一條 `live` 就 reboot 嘅話，嗰個 session 就會漏掉。micro:bit 所有按 session latch 嘅嘢（`r300.liveCount`、自動掃描）都 key 喺呢度（`protocol.ts` 嘅 `sessionEpoch`）。
  - **重發唔會誤判**：R300 只會喺收到 ack 之前重發，所以嗰陣一條 `live` 都未服務過，reset 本身就係 no-op。
- 最長嘅 ack（`ex` 23 字、`id` 99）係 **約 101 bytes**（包 `\n`）。
- 發送規則見第 8 節（R300 每 500ms 重試、冇上限；`hello` 嘅 ack 超時係 300ms；收到 `badver` 就轉 1 秒節奏唔停手）。

### 9.3 `emo_set` —— micro:bit → R300（**兩邊都實作**）

```
{"s":"mb","id":1,"t":"r","op":"emo_set","p":{"em":"happy"},"ck":249}
```

- `em`：表情名，小寫 `[a-z_]`、最多 16 字。R300 **只驗格式，唔驗名單** —— 名單由 extension 個 dropdown 把關，唔想同一份名單住喺三個地方各自漂移。
- R300 將佢交去 `Display::SetEmotion()`，再經現有 emotion sink 轉出眼睛板。**唔會加第二個 monitor writer**，亦**唔會等眼睛板回覆**。
- 🔴 **`{"st":"ok"}` = R300 收咗並且轉發咗，唔等於眼睛板播到。** 等眼睛板回 `emotion_rsp` 要幾十 ms，喺 RX thread 度等就係 `live` 開始甩 ack 嘅配方。真正判決只可以喺 R300 log 睇。
- 表情**一直保持**（sticky），直到有新表情或者 R300 自己狀態轉換蓋過佢。冇 `ms`、冇 auto-revert。

**合約名單（19 個）** —— extension dropdown 出呢啲，其他一律唔應該送：

```
happy sad angry surprised shocked
confused funny laughing silly crying
embarrassed loving kissy winking cool
confident suspicious relaxed delicious
```

點揀出嚟嘅：眼睛板三個 profile（floki／pengu／bduck）嘅 `gif_table` 分別有 27／27／29 個名，**交集 26 個**（唯一唔共通係 `sleepy`，bduck 冇）。交集再剔走 8 個**系統狀態名** —— `connecting` `disconnected` `listening` `neutral` `standby` `startup` `thinking` `sleepy` —— 淨低就係呢 19 個表情。

⚠️ 三個唔應該放出去嘅理由，逐個唔同：
- `disconnected`／`connecting`／`startup`／`listening`／`thinking`／`standby` —— **講大話**。學生揀「斷線中」唔會令部機真係斷線，個面同真實狀態對唔上。
- `neutral` —— 部機 idle 嗰陣會被 `MonitorStateForwarder` **remap 做 `standby`**（即係 `sleepy` GIF），揀完根本唔係嗰個樣。
- `sleepy` —— bduck profile 冇呢個 GIF，換咗角色就會收到 `unknown`。

最長嘅名係 `embarrassed`（11 字），`id` 99 時成行 75 bytes（唔計 `\n`）。

### 9.4 `leg_set` —— micro:bit → R300（**兩邊都實作**）

```
{"s":"mb","id":42,"t":"r","op":"leg_set","p":{"ro":0,"fd":100,"ms":1000},"ck":78}
```

| 欄位 | 值 |
|---|---|
| `ro` | **-100..100** 整數百分比（100 = 全速） |
| `fd` | **-100..100** 整數百分比 |
| `ms` | **0..3000** |

- 🔴 **三個 key 都一定要有。** 少一個 → `badarg`——**唔會當 0**。一個當 0 嘅缺欄位會將一句爛咗嘅指令變成一句靜靜哋嘅停車。
- `ro`／`fd` **兩者都係 0 = 停車**（`ms` 會被忽略）。其餘情況 `ms` 一定要 **> 0**：`0` 會被 motor board 讀成「用佢自己個預設時長行呢個速度」，唔係你想要嘅嘢，所以 R300 直接回 `badarg` 而唔係猜你想點。
- 範圍唔啱 → `badarg`，**唔會幫你 clamp**（靜靜哋 clamp 教唔到嘢，一樣會出乎意料）。
- R300 **郁之前**就回 `ack`——`{"st":"ok"}` 代表「收咗」，唔代表「郁完」。幾時停係由 `ms` 話事。
- R300 實際送 `x<ro/100> y<fd/100> t<ms>` 落 motor board（`ro`→x、`fd`→y），停車就係 `x0.0 y0.0`。⚠️ 呢條 motor UART **冇 terminator**，一句跟一句咁黐埋係已知風險。

### 9.5 `arm_set` —— micro:bit → R300（**兩邊都實作**）

```
{"s":"mb","id":43,"t":"r","op":"arm_set","p":{"a1":100,"a2":50},"ck":187}
```

| 欄位 | 手 | 值 |
|---|---|---|
| `a1` | servo1 = **右手** | physical 角度 **0..180** |
| `a2` | servo2 = **左手** | physical 角度 **0..180** |

physical 角度：**0 = 指前、90 = 指向下、180 = 指後**。鏡像（邊個 servo 喺邊邊）由 R300 內部換算，micro:bit 唔使知。

- 🔴 **某隻手唔想郁 = 唔寫喺個 key，唔可以寫 `0`。** `0` 係合法角度（指前）——寫 `0` 係「將隻手指向前」，唔係「唔好郁」。
- **兩個 key 都唔寫** → `badarg`（一個冇嘢做嘅指令唔應該回 `ok`）。
- **R300 先驗晒兩個先郁任何一隻。** 一個唔合法嘅 `a2` 唔會留低「`a1` 已經郁咗」嘅半執行狀態——嗰種狀態發送方係偵測唔到嘅。
- 範圍唔啱 → `badarg`，唔會 clamp。
- 郁之前回 `ack`（同 9.4 一樣嘅語義）。
- ⚠️ `a1`／`a2` ↔ 左右手嘅對應係**假設**（跟 servo 編號 1=右、2=左），要上機撳一次確認。

### 9.6 `vol_set` / `vol_done` —— 音量（**兩邊都實作**）

第一個有**兩段回覆**嘅 op。`ack` 一路以嚟只代表「R300 收咗」；馬達冇得講多過呢句（郁緊嗰陣 ack 早就返咗），但音量係同步寫得完嘅，所以 R300 講多一句。**佢唔係用一個新嘅 `t`** —— 而係用 envelope 本身容許嘅方法：R300 自己起一個 `req`。

```
mb   -> R300 : {"s":"mb","id":3,"t":"r","op":"vol_set","p":{"vl":70},"ck":28}
R300 -> mb   : {"s":"r300","id":3,"t":"a","op":"vol_set","p":{"st":"ok"},"ck":253}      ← 收咗
R300 -> mb   : {"s":"r300","id":7,"t":"r","op":"vol_done","p":{"vl":70},"ck":176}     ← 真係落咗
mb   -> R300 : {"s":"mb","id":7,"t":"a","op":"vol_done","p":{"st":"ok"},"ck":37}
R300 -> mb   : {"s":"r300","id":7,"t":"f","op":"vol_done","p":{"rt":8},"ck":121}
```

| 欄位 | 值 |
|---|---|
| `vl` | **0..100** 整數百分比 |

- 範圍唔啱 → `badarg`，**唔會 clamp**（同 9.4／9.5 一樣嘅規矩）。
- 0..100 呢個範圍係同 R300 本身把聲控 tool（`self.audio_speaker.set_volume`）**夾硬對齊**嘅 —— 兩個入口收唔同嘢嘅話，學生用把聲設同用 micro:bit 設就會唔一致。
- 🔴 **`vol_done` 唔保證一定嚟。** 佢冇 retry：音量無論點都已經設咗，而條 link 生唔生存係 `live` 話事，唔係佢。micro:bit 側**唔可以**靠等 `vol_done` 嚟決定下一步。
- ⚠️ **最新取代（latest-wins）**：學生喺 `forever` 入面掃音量，R300 只會就**最後嗰個值**發一次 `vol_done`，唔會逐格回。

### 9.7 `mcp_desc` / `mcp_take` / `mcp_done` —— 錄低一段動作，變成 AI 叫得郁嘅 tool（**兩邊都實作**）

⚠️ **micro:bit 側由 `r300.describe()` / `r300.takeStart()` / `r300.takeFinish()` 發出；`mcp_done` 由 `protocol.ts` 嘅 `handleLine()` 收到，結果喺 `r300.lastTakeName` / `.lastTakeSteps` / `.lastTakeDrop`。**

🔴 **`mcp_done` 係 R300 唯一一個「發一次、唔重試」嘅 req。** 收到冇 handler 嘅話佢會答 `noop`，而 R300 只會 log 一句失敗就當冇回事 —— **嗰次錄影嘅 `steps`／`drop` 就永久消失**，micro:bit 永遠唔會知段舞截咗。所以呢個 op 喺 dispatch table 入面係一定要有嘅（2026-09-13 之前一直冇，即係每次錄影都靜靜雞掉失呢兩個數）。

學生自己寫嘅動作（`leg_set`／`arm_set`）可以錄低，然後喺 R300 註冊成一個 MCP tool，之後**用把口叫個名**就播得返。

```
mb -> R300 : {"s":"mb","id":5,"t":"r","op":"mcp_desc","p":{"name":"wave","desc":"waves hello"},"ck":150}
mb -> R300 : {"s":"mb","id":6,"t":"r","op":"mcp_take","p":{"state":"start"},"ck":177}
             …（其間所有被 R300 接受咗嘅 leg_set / arm_set 會逐句錄低）…
mb -> R300 : {"s":"mb","id":7,"t":"r","op":"mcp_take","p":{"state":"finish"},"ck":5}
R300 -> mb : {"s":"r300","id":8,"t":"r","op":"mcp_done","p":{"name":"wave","steps":6,"drop":0},"ck":141}
```

| op | `p` | 意思 |
|---|---|---|
| `mcp_desc` | `{"name":N,"desc":D}` | 記低名同描述。**同一個 `name` 再叫一次 = 將 `D` 駁落去後面**（長描述就係咁分幾句send）；換咗個 `name` 就由頭開始 |
| `mcp_take` | `{"state":"start"}` | 開始錄。名要事先 `mcp_desc` 過 |
| `mcp_take` | `{"state":"finish"}` | 收貨，註冊做 MCP tool `self.microbit.<name>` |
| `mcp_done` | `{"name":N,"steps":S,"drop":M}` | R300 → micro:bit：真係註冊咗，共 `S` 步，掉咗 `M` 步 |

- `name`：**1-16 個字元，淨係 `[a-z0-9_]`**。佢會變成 MCP tool 名俾 AI 用，所以唔可以有空格同大細柚。唔合法 → `badarg`。micro:bit 側 `describe()` 會用同一條規則喺本地先擋（唔啱 → 回 `badarg`，唔使等 ack）。
- 🔴 **`drop` 一定要睇。** 上限 **64 步**，超出嘅會照樣即時執行但**唔會錄入去**。唔報呢個數，一段被截斷咗嘅錄影同一段完整嘅錄影喺 micro:bit 側係一模一樣嘅。
- `desc` 有自己嘅 per-call 上限：micro:bit 側每次最多帶 **34 個字**（`kMaxDescChars`；學生版塊係 32）—— 行長上限 253 之下其實擺得落更多，34 係刻意留水位嘅選擇。描述長過呢個數就分幾次 `mcp_desc` send（同名會 append）。超額 → 本地直接回 `"long"`。
- 空錄影（`start` 之後乜都冇做就 `finish`）→ `badarg`。未 `start` 就 `finish` → `badarg`。
- ⚠️ **同名重錄：舞步即時更新，描述文字唔會。** R300 上面個 tool object 只註冊一次，而佢個描述欄位係上游 engine 嘅 private member、冇 setter（呢個係刻意決定：唔改 engine 檔）。所以改咗描述要**重開 R300** 先生效 —— R300 會喺 log 出 warning 講明，唔會扮咗當成功。舞步唔受影響，因為播嘅時候先去攞最新嗰段。

## 10. R300 開機

- RX task 起嗰陣先 `uart_flush_input()`，清走 R300 未 ready 之前囤住嘅過時訊息。Phase 2 之後尤其重要：一句 10 秒前嘅郁指令喺 R300 開完機先執行，部機會突然自己郁。（v0 時期實測：R300 一 ready 就有 11–12 條喺 100ms 內湧入。）
- 開機時 R300 **未 handshake**：佢淨係發 `hello`，所以線上根本唔會有其他 `req`。micro:bit 收到 `hello` 就答。
- ⚠️ **micro:bit 唔可以當「收到 `hello`」就等於「R300 剛開機」**：R300 每次開機都會重問，而且佢會每 500ms 重發直到收 ack —— 兩者一樣樣。判別靠「**係唔係自己已經 ack 過一次之後嘅第一條 `hello`**」（第 9.2 節）。分得到嘅話，micro:bit 就可以每個 session 都由頭做一次自己嘅嘢（例：`test.ts` 每個 session 自動跑一次掃描，唔係每次上電跑一次）。

## 11. Test vectors

兩邊實作都應該對住呢個表逐條驗。`bytes` 包埋 `\n`。

| 用途 | `ck` | bytes | 完整一行 |
|---|---|---|---|
| hello req（R300 每 500ms 發） | 129 | 75 | `{"v":2,"s":"r300","id":3,"t":"r","op":"hello","p":{"fw":"1.0.0"},"ck":129}` |
| hello ack（mb 答） | 233 | 83 | `{"v":2,"s":"mb","id":3,"t":"a","op":"hello","p":{"st":"ok","ex":"0.1.0"},"ck":233}` |
| hello fin（R300 發） | 93 | 63 | `{"s":"r300","id":3,"t":"f","op":"hello","p":{"rt":11},"ck":93}` |
| live req（handshake 成功之後） | 65 | 55 | `{"s":"r300","id":5,"t":"r","op":"live","p":{},"ck":65}` |
| live ack | 90 | 70 | `{"s":"mb","id":5,"t":"a","op":"live","p":{"st":"ok","id":42},"ck":90}` |
| live fin | 209 | 62 | `{"s":"r300","id":5,"t":"f","op":"live","p":{"rt":8},"ck":209}` |
| live badck ack | 52 | 75 | `{"s":"mb","id":5,"t":"a","op":"live","p":{"st":"err","e":"badck"},"ck":52}` |
| live badver ack（帶 v） | 5 | 81 | `{"v":2,"s":"mb","id":5,"t":"a","op":"live","p":{"st":"err","e":"badver"},"ck":5}` |
| hello ack 最長（`ex` 23 字、`id` 99） | 232 | 102 | `{"v":2,"s":"mb","id":99,"t":"a","op":"hello","p":{"st":"ok","ex":"01234567890123456789012"},"ck":232}` |
| emo_set req | 249 | 69 | `{"s":"mb","id":1,"t":"r","op":"emo_set","p":{"em":"happy"},"ck":249}` |
| emo_set ack ok | 235 | 68 | `{"s":"r300","id":1,"t":"a","op":"emo_set","p":{"st":"ok"},"ck":235}` |
| emo_set badarg ack | 14 | 81 | `{"s":"r300","id":1,"t":"a","op":"emo_set","p":{"st":"err","e":"badarg"},"ck":14}` |
| leg_set req | 78 | 82 | `{"s":"mb","id":42,"t":"r","op":"leg_set","p":{"ro":0,"fd":100,"ms":1000},"ck":78}` |
| arm_set req | 187 | 74 | `{"s":"mb","id":43,"t":"r","op":"arm_set","p":{"a1":100,"a2":50},"ck":187}` |
| vol_set req | 28 | 63 | `{"s":"mb","id":3,"t":"r","op":"vol_set","p":{"vl":70},"ck":28}` |
| vol_set ack ok | 253 | 68 | `{"s":"r300","id":3,"t":"a","op":"vol_set","p":{"st":"ok"},"ck":253}` |
| vol_set badarg ack | 32 | 81 | `{"s":"r300","id":3,"t":"a","op":"vol_set","p":{"st":"err","e":"badarg"},"ck":32}` |
| vol_done req (R300) | 176 | 67 | `{"s":"r300","id":7,"t":"r","op":"vol_done","p":{"vl":70},"ck":176}` |
| vol_done ack (mb) | 37 | 66 | `{"s":"mb","id":7,"t":"a","op":"vol_done","p":{"st":"ok"},"ck":37}` |
| vol_done fin (R300) | 121 | 66 | `{"s":"r300","id":7,"t":"f","op":"vol_done","p":{"rt":8},"ck":121}` |
| mcp_desc req | 150 | 92 | `{"s":"mb","id":5,"t":"r","op":"mcp_desc","p":{"name":"wave","desc":"waves hello"},"ck":150}` |
| mcp_take start req | 177 | 73 | `{"s":"mb","id":6,"t":"r","op":"mcp_take","p":{"state":"start"},"ck":177}` |
| mcp_take finish req | 5 | 72 | `{"s":"mb","id":7,"t":"r","op":"mcp_take","p":{"state":"finish"},"ck":5}` |
| mcp_done req (R300) | 141 | 92 | `{"s":"r300","id":8,"t":"r","op":"mcp_done","p":{"name":"wave","steps":6,"drop":0},"ck":141}` |
| mcp_done ack (mb) | 21 | 66 | `{"s":"mb","id":8,"t":"a","op":"mcp_done","p":{"st":"ok"},"ck":21}` |
| **mcp_desc 最長（name 16＋desc 34）** | 150 | 128 | `{"s":"mb","id":99,"t":"r","op":"mcp_desc","p":{"name":"abcdefghijklmnop","desc":"dddddddddddddddddddddddddddddddddd"},"ck":150}` |
| **mcp_done 最長（name 16）** | 10 | 106 | `{"s":"r300","id":99,"t":"r","op":"mcp_done","p":{"name":"abcdefghijklmnop","steps":64,"drop":64},"ck":10}` |

（v1 舊表全部唔適用：v2 加咗 `s`、`t` 變單字、`v` 淨係 handshake 帶、key 縮短咗。呢個表係 v2。另：v1 嗰兩條 `live req … "hs":1 / "hs":0` 同 `emo_set nohs ack` 喺 v1 後期已經取消。）

兩個必過嘅反例：
- **改一個 byte 一定要捉到**：`hello req` 將 `"hello"` 改做 `"hellp"`，收方重新計出嚟**必須唔等於原句嗰個 ck**（一個 byte 就爭 11）。
- **Payload 有 `,"ck":` 字串唔可以搵錯**：`{"s":"mb","id":7,"t":"r","op":"say","p":{"m":",\"ck\":99"},"ck":123}`——收方搵**最後一個** `,"ck":` 必須讀到句尾嗰個數（唔係 payload 入面嘅 99）兼驗證通過。（`say` 只係攞嚟測 parser。）

最長嘅訊息：`hello ack` 喺 `ex` 23 字、`id` 99 時係 **約 101 bytes**（唔計 `\n`）；`emo_set` 最長 75 bytes。全部離 253 仲有大把位。

9.6／9.7 咢批最長係 `mcp_desc` 嘅 **127 bytes**（`name` 16＋`desc` 34——個 cap 就係佢），`mcp_done` 最長 106 bytes。`mcp_desc` 係**唯一一個真係會迫近上限**嘅 op——`desc` 係學生自己打嘅字。所以佢個長度規則寫咗喺 9.7，唔可以靠估。
