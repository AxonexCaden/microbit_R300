# R300 ↔ micro:bit UART Protocol v1

> 呢份係 `microbit_R300`（micro:bit extension，`r300.ts`／`protocol.ts`）同 `CompanionRobots`（R300 firmware，`aimo-v1-edu-microbit` board：`microbit_command_router.h`／`microbit_link.h`）之間**唯一嘅合約**。兩邊實作有衝突，以呢份為準；要改 wire format，先改呢份再改 code。
>
> **狀態**：v1。**R300 側已全部實作並上機驗證**（R300 主導嘅 `hello` handshake + `live` check，見 `CompanionRobots` IssuesAndProgress.md 2 Phase 219）；**micro:bit 側淨係實作咗收方**（識答 `hello`／`live`，未有任何 sender）。`emo_set`／`leg_set`／`arm_set` 格式已定但未實作。
> ⚠️ **方向喺 2026-09-11 反轉咗**：`hello` 原本係 micro:bit → R300，而家係 **R300 → micro:bit**（每 500ms 一次，冇上限，直到收 ack）；`live` 亦**只喺 handshake 成功之後**先開始。連帶 `p.hs`、「未 handshake 就回 `nohs`」、同「micro:bit `connect()` 第一句發 `hello`」三樣全部取消。
> ⚠️ v0（`{"MB_cmd":"test"}`／`{"MicroBit":…}`／`{"cmd":"control_motor"}`）同 v1 **互不相容**，兩邊要一齊換。

## 1. 物理層

| 項目 | 值 |
|---|---|
| 介面 | UART，115200 baud，8N1 |
| 接線 | micro:bit **P0 (TX) → R300 GPIO21 (RX)**；micro:bit **P1 (RX) ← R300 GPIO10 (TX)**；**必須共地** |
| R300 側 | `UART_NUM_0`（`MicrobitLink`），RX line buffer 128 bytes |
| micro:bit 側 | `serial.redirect(P0, P1, 115200)` 之後**必須**即刻 `serial.setRxBufferSize(128)` + `serial.setTxBufferSize(128)` |

⚠️ micro:bit 預設 serial buffer 得 **20 bytes**，呢個 protocol 最短嗰句都超過 50 bytes。唔加大嘅話 ring buffer 喺 `\n` 到之前已經捲咗，症狀係**完全冧聲**，同條線冇駁一模一樣。

## 2. Framing

- 每條訊息 = **一個 JSON object + 一個 `\n`**。發送方只用 `\n`；收方將 `\n` 同 `\r` 都當行尾。
- **只准 ASCII**。checksum 係 byte 加總，而 micro:bit 用 `charCodeAt()` 計——只有 ASCII 下兩邊保證一樣。
- **唔准有空白**。
- **每行最多 127 bytes（唔計 `\n`）**。R300 個 line buffer 係 `char buf[128]`，超長嘅行會**成行靜靜哋丟棄，冇 log、冇 ack**——所以發送方一定要自己保證唔超。

## 3. Envelope

```json
{"v":1,"id":128,"t":"req","op":"hello","p":{"fw":"1.0.0"},"ck":88}
```

| 欄位 | 型別 | 意思 |
|---|---|---|
| `v` | int | Protocol 版本，而家係 `1`。**只喺 wire format 有 breaking change 先變**，唔係 firmware 版本（版本字串喺 `hello` 交換，見 9.2） |
| `id` | int | 關聯 ID（第 5 節）。`ack`／`fin` 原封 echo 返 `req` 嗰個 |
| `t` | string | 邊一段：`"req"`／`"ack"`／`"fin"` |
| `op` | string | 種類（第 9 節）。`ack`／`fin` echo 返 `req` 嗰個 |
| `p` | object | Payload，形狀跟 `op` 同 `t` 變。**冇內容都要寫 `{}`** |
| `ck` | int | 校驗碼（第 4 節）。**一定係最後一個欄位** |

發送方**必須**照 `v, id, t, op, p, ck` 次序輸出。收方**只可以**依賴 `ck` 係最後一個欄位，其餘次序唔可以假設。

⚠️ **`v`、`id`、`t`、`op`、`p.st`、`p.e` 嘅意思同第 4 節嘅 `ck` 規則，喺將來所有版本都唔准改。** 咁唔同版本之間先講得出「版本唔夾」（第 7 節 #3 例外）。

## 4. `ck` 點計

演算法：**全部 byte 加埋 mod 256**。

**發送方**
1. 砌好冇 `ck` 嘅完整 object，例如 `{"v":1,"id":128,"t":"req","op":"hello","p":{"fw":"1.0.0"}}`
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
| micro:bit | **0–127** |
| R300 | **128–255** |

- 各自喺自己範圍內遞增、循環。一睇數字就知邊個發起。
- **重試用返同一個 `id`**（第 8 節）。
- R300 每次開機由 128 開始數，`hello` 同 `live` 都用呢個範圍；micro:bit 由 0 開始（Phase 2 之後佢開始發 `req` 先有意義）。
- 去重記錄幾時清，見第 7.2 節 —— **R300 收到 `hello` 嘅 ack 之後清自己嘅**。micro:bit 唔去重，所以佢冇嘢要清。

## 6. 三段：`req` → `ack` → `fin`

```
發起方 ──req──→ 對方
發起方 ←──ack── 對方      對方收到 req 之後回
發起方 ──fin──→ 對方      發起方收到「最終」ack 之後回
```

- **邊個發 `req`，邊個負責發 `fin`。** `fin` 個 `p` 係 `{"rtt":N}`，N = 由**最後一次**發出 `req` 到收到 `ack` 嘅毫秒數。
- **最終 ack** = `st:"ok"`，或者一個**唔會重試**嘅錯誤（第 7.1 節）。收到會重試嘅錯誤（`badck`）或者超時就**唔發 `fin`**。
- 重試用晒都冇收到 ack → **唔發 `fin`**。
- 🔴 **任何人都唔准回覆 `ack` 或者 `fin`。** 回覆一個 ack 會觸發對方再回覆，兩塊板會 ping-pong 到永遠。

## 7. 收方處理次序

收到一行，**照呢個次序**檢查：

| # | 檢查 | 唔通過點做 |
|---|---|---|
| 1 | Parse 到 JSON，而且係有內容嘅 object | **丟，唔回覆** |
| 2 | `ck` 存在而且啱（後面**只准**跟最後一個 `}`——多咗任何 byte，連空白都算唔啱） | `,"ck":` **完全唔存在** → **丟，唔回覆**（呢條唔係本 protocol 出嘅行）；`ck` 唔啱但 `t`=`"req"`、`id` 係 0–255 整數、`op` 係合法 token → 回 `{"st":"err","e":"badck"}`；`t`／`id`／`op` 任何一樣讀唔到 → **丟，唔回覆** |
| 3 | `v` 等於自己嘅版本 | `t`=`"req"` → 回 `{"st":"err","e":"badver"}`，`v` 填**自己**嘅版本；其他 → **丟**，但 **log 一定要印出對方個 `v`**（第 9.1 節）。**例外**：`t`=`"ack"`、`p.e`=`"badver"`，而且 `id`／`op` 對得上自己等緊嘅 req → **照讀**，當收到 `badver`（對方個 ack 一定用緊佢自己個 `v`，唔開例外就永遠讀唔到） |
| 4 | 按 `t` 分派 | 見下 |

**`t:"req"`**
1. `id` 同 `op` 都等於上一個處理過嘅 `req` → **唔再執行**，重播上次個 `ack`（第 7.2 節）
2. 唔識個 `op` → 回 `{"st":"err","e":"noop"}`
3. `p` 內容唔啱 → 回 `{"st":"err","e":"badarg"}`
4. 執行，回 `{"st":"ok"}`（或者該 op 指定嘅 ack payload）

（原本呢度仲有一步「未 handshake 就回 `nohs`」——R300 主導 handshake 之後取消咗：R300 未 handshake 之前根本唔會發任何其他 `req`。）

**`t:"ack"`**：`id` **同** `op` 都等於自己而家等緊嘅 `req` → 接受；否則 → **丟**，計一次 stale。

**`t:"fin"`**：記錄就得，**唔回覆**。

🔴 **「收到一條合法訊息」= 通過咗 #1–#3。** 任何「對方仲生存」嘅判斷（第 9.1 節 idle-skip）都**只可以**計通過 `ck` 嘅行。

### 7.1 錯誤碼

| `e` | 意思 | 發送方點做 |
|---|---|---|
| `badck` | 校驗碼唔啱，傳輸途中爛咗 | ✅ 用同一個 `id` 重試 |
| `badver` | Protocol 版本唔夾 | ❌ **停止再送**，向使用者報錯 |
| `noop` | 收方唔識呢個 `op` | ❌ |
| `badarg` | `p` 內容唔啱（缺欄位、超範圍） | ❌ 重送一萬次都係同一結果 |
| `busy` | 收方暫時唔接受（Phase 4 緊急停機先會出現） | ❌ |

### 7.2 去重（收 `req` 嗰邊）

收方記住**上一個處理過嘅 `req` 嘅 `id` 同 `op`**，同埋**當時回嘅 `ack` 原文**。`id` 同 `op` 都一樣 → 直接重播嗰句 ack，**唔重新執行**。

- **點解要去重**：`ack` 途中爛咗，發送方會用同一個 `id` 重送。收方如果再執行，`leg_set {"fwd":100,"ms":1000}` 就會令部車行 **2 秒**而唔係 1 秒。
- **點解要比埋 `op`**：`id` 會重用（繞完 128 個返 0）。
- **Session 由 R300 收到 `hello` 嘅 ack 劃分**：R300 一收到就**清空自己嘅去重記錄**。micro:bit 唔去重（佢唔 cache 回覆），所以佢冇嘢要清。
  ⚠️ **已知缺口**：micro:bit **自己** reset 冇人會清 R300 個記錄 —— 佢 reset 後由 `id` 0 重新數，如果第一句撞正上一輪最後執行過嗰句（例如 `emo_set id 1`），R300 會當係重送、**唔執行但回 ok**。補法係「`live` 連續失敗報 `LOST` → 重新入 handshake 階段」，未做。
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
- 收到 ack（`st:"ok"`）→ log 對方個 `ext` → **清空自己嘅去重記錄** → 發 `fin`（帶 `rtt`）→ 開始 `live`。
- 收到 `badver` → **停手 + log 出嚟**，唔重試（版本唔夾，重試一萬次都一樣）。

**micro:bit 額外規則（回應方）**
- `connect()` 之後**唔使主動發任何嘢**（包括 `hello`）——R300 會自己嚟問。
- 收到 `hello` req 即刻回 ack，`p` 帶自己嘅 `ext`（同 `pxt.json` 個 `version` 一致）。
- Phase 1 佢**完全被動**：冇 sender、冇 `id` 分配、冇 retry、冇 queue。
- （Phase 2 之後佢開始發 `req` 嗰陣，上面張表同「每個方向一個 in-flight」就一樣適用。）

## 9. Ops

### 9.1 `live` —— R300 → micro:bit（Phase 1）

R300 用嚟知道 micro:bit 仲連唔連住。

```
① R300 → {"v":1,"id":128,"t":"req","op":"live","p":{},"ck":104}
② mb   → {"v":1,"id":128,"t":"ack","op":"live","p":{"st":"ok"},"ck":210}
③ R300 → {"v":1,"id":128,"t":"fin","op":"live","p":{"rtt":8},"ck":109}
```

| 項目 | 值 |
|---|---|
| 幾時開始 | **`hello` handshake 成功之後先開始**（見 9.2）。未 handshake 之前 R300 一條 `live` 都唔會發 |
| 週期 | **500ms** |
| 等 ack | **300ms**（一定要細過週期） |
| 判斷斷線 | **連續 3 次**冇 ack → `LOST`；**一次成功即清零** |
| Idle-skip | 過去 500ms 內收過任何**通過 `ck`+`v`、而且唔係 `live`** 嘅訊息 → 今個週期唔發，當成功 |
| 斷線後果 | **只出 log warning**，唔停任何嘢 |
| 統計 | 每 30 秒一行 `stats:`（ok／miss／skip／late／stale／lost／max_recovered_streak／rtt_max） |

- ⚠️ **`live` 唔用第 8 節嘅重試**，用連續失敗計數。
- ⚠️ **`live` 自己嘅 ack 唔計入 idle-skip**，否則 `live` 會 skip 自己，實際變 1Hz。
- 只有 ② 影響 R300 嘅判斷；③ 係俾 micro:bit 知道自己把聲去到 R300。
- ⚠️ 呢個係**主動 probe**，即係之前因為串擾（假 `LOST`）而拆走嘅嗰類機制 —— `stats:` 就係用嚟量度真實失敗率、再決定門檻嘅依據。
- ⚠️ **版本唔夾時，R300 讀唔到對方個 `badver`**（對方 ack 用緊佢自己個 `v`，會被丟）→ 第 7 節 #3 嘅例外就係為咗處理呢個情況（`t:"ack"` + `p.e:"badver"` + `id`／`op` 對得上等緊嗰個 req → 照讀）。R300 側已經實作。

### 9.2 `hello` —— R300 → micro:bit（handshake，**已實作**）

R300 主動：開機之後每 500ms 發一次，直到 micro:bit 答。Session 由呢一步劃分，版本亦係喺呢一步交換。

```
① R300 → {"v":1,"id":128,"t":"req","op":"hello","p":{"fw":"1.0.0"},"ck":88}
② mb   → {"v":1,"id":128,"t":"ack","op":"hello","p":{"st":"ok","ext":"0.1.0"},"ck":98}
③ R300 → {"v":1,"id":128,"t":"fin","op":"hello","p":{"rtt":11},"ck":251}
```

- `fw`：R300 firmware 版本，只准 `[A-Za-z0-9._+-]`、最多 23 字。**唔係 `v`**：`fw` 每次 release 都變，`v` 只喺 wire format 破格先變。micro:bit 收到可以只 log 低（Phase 5 個版本 block 會讀）。
- `ext`：micro:bit extension 版本（同 `pxt.json` 個 `version` 一致）。**R300 收到會 log 出嚟** —— 呢個係 ack 唯一「載住對方自己知、R300 估唔到」嘅值，所以 R300 讀得到就證明①真係到咗、而且對面真係答得出（唔止係電線通）。
- `ext` 建議保持 **23 字之內**（同 `fw` 對稱）—— ⚠️ R300 **唔會**截短或者拒收，純粹係留位：23 字嘅 `ext` 令呢句去到 96 bytes，遠低於 127。
- R300 收到 ack 之後：**清空自己嘅去重記錄** → 發 `fin` → 開始 `live`。
- ⚠️ **R300 每一次開機都會重新問一次**，唔理 micro:bit 覚唔覚得自己 handshake 過。所以 R300 reboot 唔需要 micro:bit 做任何嘢 —— 舊設計嗰兩個機制（`live` 帶 `p.hs:0`、未 handshake 回 `nohs`）**已經取消**。
- ⚠️ **反方向冇解**：micro:bit 自己 reset／換咗另一隻，R300 唔會發覺（因為佢唔會再問）。已知缺口，見 7.2。
- 最長嘅 ack（`ext` 23 字、`id` 127）係 **96 bytes**（包 `\n`）。
- 發送規則見第 8 節（R300 每 500ms 重試、冇上限；`hello` 嘅 ack 超時係 300ms）。

### 9.3 `emo_set` —— micro:bit → R300（Phase 2a，**未實作**）

```
{"v":1,"id":1,"t":"req","op":"emo_set","p":{"emoji":"happy"},"ck":50}
```

- `emoji`：表情名，小寫 `[a-z0-9_]`、最多 16 字。R300 **只驗格式，唔驗名單**——名單由 extension 個 dropdown 把關。
- R300 將佢轉交顯示系統（同一條路轉去眼睛板），**唔會等眼睛板回覆**。
- 🔴 **`{"st":"ok"}` = R300 收咗並且轉發咗，唔等於眼睛板播到。**
- 表情**一直保持**，直到有新表情（或者 R300 自己狀態轉換）蓋過佢。
- 最長嘅名（`disconnected`，`id` 127）係 80 bytes。

### 9.4 `leg_set` —— micro:bit → R300（**兩邊都實作**；micro:bit 側暫時係測試用嘅 `r300.motor()`）

```
{"v":1,"id":42,"t":"req","op":"leg_set","p":{"rot":0,"fwd":100,"ms":1000},"ck":48}
```

| 欄位 | 值 |
|---|---|
| `rot` | **-100..100** 整數百分比（100 = 全速） |
| `fwd` | **-100..100** 整數百分比 |
| `ms` | **0..3000** |

- 🔴 **三個 key 都一定要有。** 少一個 → `badarg`——**唔會當 0**。一個當 0 嘅缺欄位會將一句爛咗嘅指令變成一句靜靜哋嘅停車。
- `rot`／`fwd` **兩者都係 0 = 停車**（`ms` 會被忽略）。其餘情況 `ms` 一定要 **> 0**：`0` 會被 motor board 讀成「用佢自己個預設時長行呢個速度」，唔係你想要嘅嘢，所以 R300 直接回 `badarg` 而唔係猜你想點。
- 範圍唔啱 → `badarg`，**唔會幫你 clamp**（靜靜哋 clamp 教唔到嘢，一樣會出乎意料）。
- R300 **郁之前**就回 `ack`——`{"st":"ok"}` 代表「收咗」，唔代表「郁完」。幾時停係由 `ms` 話事。
- R300 實際送 `x<rot/100> y<fwd/100> t<ms>` 落 motor board（`rot`→x、`fwd`→y），停車就係 `x0.0 y0.0`。⚠️ 呢條 motor UART **冇 terminator**，一句跟一句咁黐埋係已知風險。

### 9.5 `arm_set` —— micro:bit → R300（**兩邊都實作**；micro:bit 側暫時係測試用嘅 `r300.arm()`）

```
{"v":1,"id":43,"t":"req","op":"arm_set","p":{"a1":100,"a2":50},"ck":178}
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

## 10. R300 開機

- RX task 起嗰陣先 `uart_flush_input()`，清走 R300 未 ready 之前囤住嘅過時訊息。Phase 2 之後尤其重要：一句 10 秒前嘅郁指令喺 R300 開完機先執行，部機會突然自己郁。（v0 時期實測：R300 一 ready 就有 11–12 條喺 100ms 內湧入。）
- 開機時 R300 **未 handshake**：佢淨係發 `hello`，所以線上根本唔會有其他 `req`。micro:bit 收到 `hello` 就答 —— 佢唔使「察覺」R300 reboot 過咗。

## 11. Test vectors

兩邊實作都應該對住呢個表逐條驗。`bytes` 包埋 `\n`。

| 用途 | `ck` | bytes | 完整一行 |
|---|---|---|---|
| hello req（R300 每 500ms 發） | 88 | 67 | `{"v":1,"id":128,"t":"req","op":"hello","p":{"fw":"1.0.0"},"ck":88}` |
| hello ack（mb 答） | 98 | 78 | `{"v":1,"id":128,"t":"ack","op":"hello","p":{"st":"ok","ext":"0.1.0"},"ck":98}` |
| hello fin（R300 發） | 251 | 64 | `{"v":1,"id":128,"t":"fin","op":"hello","p":{"rtt":11},"ck":251}` |
| live req（handshake 成功之後） | 104 | 55 | `{"v":1,"id":128,"t":"req","op":"live","p":{},"ck":104}` |
| live ack | 210 | 64 | `{"v":1,"id":128,"t":"ack","op":"live","p":{"st":"ok"},"ck":210}` |
| live fin | 109 | 62 | `{"v":1,"id":128,"t":"fin","op":"live","p":{"rtt":8},"ck":109}` |
| live badck ack | 137 | 77 | `{"v":1,"id":128,"t":"ack","op":"live","p":{"st":"err","e":"badck"},"ck":137}` |
| live badver ack | 8 | 76 | `{"v":1,"id":128,"t":"ack","op":"live","p":{"st":"err","e":"badver"},"ck":8}` |
| hello ack 最長（`ext` 23 字、`id` 127） | 33 | 96 | `{"v":1,"id":127,"t":"ack","op":"hello","p":{"st":"ok","ext":"01234567890123456789012"},"ck":33}` |
| emo_set req（2a） | 50 | 70 | `{"v":1,"id":1,"t":"req","op":"emo_set","p":{"emoji":"happy"},"ck":50}` |
| emo_set ack ok（2a） | 164 | 65 | `{"v":1,"id":1,"t":"ack","op":"emo_set","p":{"st":"ok"},"ck":164}` |
| emo_set badarg ack（2a） | 199 | 79 | `{"v":1,"id":1,"t":"ack","op":"emo_set","p":{"st":"err","e":"badarg"},"ck":199}` |
| leg_set req（2b） | 48 | 83 | `{"v":1,"id":42,"t":"req","op":"leg_set","p":{"rot":0,"fwd":100,"ms":1000},"ck":48}` |
| arm_set req（3） | 178 | 73 | `{"v":1,"id":43,"t":"req","op":"arm_set","p":{"a1":100,"a2":50},"ck":178}` |

（舊表嗰兩條 `live req … "hs":1 / "hs":0`（`ck` 242／241）已經唔存在。`emo_set nohs ack` 亦冇咗。）

兩個必過嘅反例：
- **改一個 byte 一定要捉到**：`hello req` 將 `"hello"` 改做 `"hellp"`，收方重新計出嚟**必須唔等於** `88`。
- **Payload 有 `,"ck":` 字串唔可以搵錯**：`{"v":1,"id":7,"t":"req","op":"say","p":{"m":",\"ck\":99"},"ck":114}`——收方搵**最後一個** `,"ck":` 必須讀到 `114` 兼驗證通過。（`say` 只係攞嚟測 parser。）

最長嘅訊息：`hello ack` 喺 `ext` 23 字、`id` 127 時係 **96 bytes**（唔計 `\n` 就 95）；`emo_set` 最長 80 bytes。全部離 127 仲有位。
