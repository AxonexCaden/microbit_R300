# R300 ↔ micro:bit UART Protocol v1

> 呢份係 `microbit_R300`（micro:bit extension，`r300.ts`／`protocol.ts`）同 `CompanionRobots`（R300 firmware，`aimo-v1-edu-microbit` board：`microbit_command_router.h`／`microbit_link.h`）之間**唯一嘅合約**。兩邊實作有衝突，以呢份為準；要改 wire format，先改呢份再改 code。
>
> **狀態**：v1 目標規格。**Phase 1 只實作 `live`**；Phase 2a 係 `hello`（handshake）+ `emo_set`；`leg_set`／`arm_set` 格式已定但未實作。
> ⚠️ **兩部機而家行緊嘅仲係舊格式（v0）**：`{"MB_cmd":"test"}`／`{"MicroBit":…}`／`{"cmd":"control_motor"}`。v0 同 v1 **互不相容**，兩邊要一齊換。

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
{"v":1,"id":128,"t":"req","op":"live","p":{"hs":1},"ck":242}
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
1. 砌好冇 `ck` 嘅完整 object，例如 `{"v":1,"id":128,"t":"req","op":"live","p":{"hs":1}}`
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
- micro:bit 每次 `connect()` 由 0 開始數；第一句 `hello` 用 `id` 0。唔會撞上一輪，因為 `hello` 會清空對方嘅去重記錄（第 7.2 節）。

## 6. 三段：`req` → `ack` → `fin`

```
發起方 ──req──→ 對方
發起方 ←──ack── 對方      對方收到 req 之後回
發起方 ──fin──→ 對方      發起方收到「最終」ack 之後回
```

- **邊個發 `req`，邊個負責發 `fin`。** `fin` 個 `p` 係 `{"rtt":N}`，N = 由**最後一次**發出 `req` 到收到 `ack` 嘅毫秒數。
- **最終 ack** = `st:"ok"`，或者一個**唔會重試**嘅錯誤（第 7.1 節）。收到會重試嘅錯誤（`badck`、`nohs`）就**唔發 `fin`**。
- 重試用晒都冇收到 ack → **唔發 `fin`**。
- 🔴 **任何人都唔准回覆 `ack` 或者 `fin`。** 回覆一個 ack 會觸發對方再回覆，兩塊板會 ping-pong 到永遠。

## 7. 收方處理次序

收到一行，**照呢個次序**檢查：

| # | 檢查 | 唔通過點做 |
|---|---|---|
| 1 | Parse 到 JSON，而且係有內容嘅 object | **丟，唔回覆** |
| 2 | `ck` 存在而且啱 | `t`=`"req"`、`id` 係 0–255 整數、`op` 係 string → 回 `{"st":"err","e":"badck"}`；任何一樣讀唔到 → **丟，唔回覆** |
| 3 | `v` 等於自己嘅版本 | `t`=`"req"` → 回 `{"st":"err","e":"badver"}`，`v` 填**自己**嘅版本；其他 → **丟**，但 **log 一定要印出對方個 `v`**（第 9.1 節）。**例外**：`t`=`"ack"`、`p.e`=`"badver"`，而且 `id`／`op` 對得上自己等緊嘅 req → **照讀**，當收到 `badver`（對方個 ack 一定用緊佢自己個 `v`，唔開例外就永遠讀唔到） |
| 4 | 按 `t` 分派 | 見下 |

**`t:"req"`**
1. `id` 同 `op` 都等於上一個處理過嘅 `req` → **唔再執行**，重播上次個 `ack`（第 7.2 節）
2. 唔識個 `op` → 回 `{"st":"err","e":"noop"}`
3. **（淨係 R300）** 自己開機之後未收過 `hello`，而呢句唔係 `hello` → 回 `{"st":"err","e":"nohs"}`（第 9.2 節）
4. `p` 內容唔啱 → 回 `{"st":"err","e":"badarg"}`
5. 執行，回 `{"st":"ok"}`（或者該 op 指定嘅 ack payload）

**`t:"ack"`**：`id` **同** `op` 都等於自己而家等緊嘅 `req` → 接受；否則 → **丟**，計一次 stale。

**`t:"fin"`**：記錄就得，**唔回覆**。

🔴 **「收到一條合法訊息」= 通過咗 #1–#3。** 任何「對方仲生存」嘅判斷（第 9.1 節 idle-skip）都**只可以**計通過 `ck` 嘅行。

### 7.1 錯誤碼

| `e` | 意思 | 發送方點做 |
|---|---|---|
| `badck` | 校驗碼唔啱，傳輸途中爛咗 | ✅ 用同一個 `id` 重試 |
| `nohs` | 收方未 handshake（例如 R300 啱啱 reboot） | ✅ 先重新 `hello`，成功之後用**同一個 `id`** 重送原本嗰句；**每句最多觸發一次** |
| `badver` | Protocol 版本唔夾 | ❌ **停止再送**，向使用者報錯 |
| `noop` | 收方唔識呢個 `op` | ❌ |
| `badarg` | `p` 內容唔啱（缺欄位、超範圍） | ❌ 重送一萬次都係同一結果 |
| `busy` | 收方暫時唔接受（Phase 4 緊急停機先會出現） | ❌ |

### 7.2 去重（收 `req` 嗰邊）

收方記住**上一個處理過嘅 `req` 嘅 `id` 同 `op`**，同埋**當時回嘅 `ack` 原文**。`id` 同 `op` 都一樣 → 直接重播嗰句 ack，**唔重新執行**。

- **點解要去重**：`ack` 途中爛咗，發送方會用同一個 `id` 重送。收方如果再執行，`leg_set {"fwd":100,"ms":1000}` 就會令部車行 **2 秒**而唔係 1 秒。
- **點解要比埋 `op`**：`id` 會重用（繞完 128 個返 0）。
- **Session 由 `hello` 劃分**：收方收到 `hello` 就**清空去重記錄**。冇呢一步，micro:bit reset 之後第一句會撞正上一輪最後一句（兩輪都由 `id` 0 開始），收方當係重送，**唔執行但回 ok**。`hello` 自己行普通去重就得：佢嘅重送會重播 ack，清兩次記錄效果一樣。
- **只有真正執行過嘅回覆先寫入去重記錄。** `badck`／`nohs`／`badver`／`noop` 呢啲喺執行之前就擋咗嘅錯誤**唔可以**記——否則同一個 `id` 嘅正確重送會永遠只收到重播嘅錯誤。
- **冪等嘅 op（`live`）可以唔 cache**，直接再答一次，出嚟嘅 ack 一模一樣。

## 8. 發送方規則

| 項目 | 值 |
|---|---|
| 等 `ack` 超時 | **500ms** |
| 重試 | 超時或 `badck` → **用同一個 `id`** 重送，最多 **2 次**（合共 3 次）。`hello` 例外，見下 |
| 同時喺線上嘅 `req` | **每個方向一個**，其餘排隊 |
| 收到對方嘅 `req` | **即刻回 `ack`，唔可以排隊**——排隊會令 `live` 被自己嘅指令塞住，變假斷線 |

**micro:bit 額外規則（handshake）**
- 收到 `live` req 而 `p.hs` 係 `0`，而自己**已經** handshake → R300 啱啱 reboot 咗 → 當自己未 handshake，**即刻重新 `hello`**。自己仲未 handshake（`hello` 進行緊）就唔理。
- `connect()` 之後**第一句一定係 `hello`**。
- 🔴 **收到 `hello` 嘅 ack 之前，唔准送任何其他 `req`**——全部排隊等。成個 session 設計就靠呢一條。
- `hello` **每 1 秒重試、冇上限**，直到收到 ack（R300 可能仲開緊機，大約 12 秒）。
- 收到 `nohs` → 重新 `hello`（照上面規則），成功後用同一個 `id` 重送原本嗰句。

## 9. Ops

### 9.1 `live` —— R300 → micro:bit（Phase 1）

R300 用嚟知道 micro:bit 仲連唔連住。

```
① R300 → {"v":1,"id":128,"t":"req","op":"live","p":{"hs":1},"ck":242}
② mb   → {"v":1,"id":128,"t":"ack","op":"live","p":{"st":"ok"},"ck":210}
③ R300 → {"v":1,"id":128,"t":"fin","op":"live","p":{"rtt":8},"ck":109}
```

| 項目 | 值 |
|---|---|
| 週期 | **500ms**，冇插 micro:bit 都照跑 |
| `p.hs` | R300 自己嘅 handshake 狀態：`1` = 開機之後收過 `hello`；`0` = 未收過（例如啱啱 reboot） |
| 等 ack | **300ms**（一定要細過週期） |
| 判斷斷線 | **連續 3 次**冇 ack → `LOST`；**一次成功即清零** |
| Idle-skip | 過去 500ms 內收過任何**通過 `ck`、而且唔係 `live`** 嘅訊息 → 今個週期唔發，當成功 |
| 斷線後果 | **只出 log warning**，唔停任何嘢 |
| Handshake | **唔受影響**：R300 照發、micro:bit 未 `hello` 都照答 |

- ⚠️ **`live` 唔用第 8 節嘅重試**，用連續失敗計數。
- ⚠️ **`live` 自己嘅 ack 唔計入 idle-skip**，否則 `live` 會 skip 自己，實際變 1Hz。
- 只有 ② 影響 R300 嘅判斷；③ 係俾 micro:bit 知道自己把聲去到 R300。
- `hs` 係 R300 reboot 之後令 micro:bit **主動**重新 handshake 嘅方法（第 8 節、第 9.2 節）。
- ⚠️ **版本唔夾時，R300 讀唔到對方個 `badver`**（對方 ack 用緊佢自己個 `v`，會被丟），所以丟嘅時候 **log 一定要印出對方個 `v`**。

### 9.2 `hello` —— micro:bit → R300（Phase 2a，**未實作**）

Handshake：劃分 session、交換版本。

```
① mb   → {"v":1,"id":0,"t":"req","op":"hello","p":{"ext":"0.1.0"},"ck":97}
② R300 → {"v":1,"id":0,"t":"ack","op":"hello","p":{"st":"ok","fw":"1.0.0"},"ck":131}
③ mb   → {"v":1,"id":0,"t":"fin","op":"hello","p":{"rtt":11},"ck":144}
```

- `ext`：micro:bit extension 版本（同 `pxt.json` 個 `version` 一致）。R300 log 低。
- `fw`：R300 firmware 版本，只准 `[A-Za-z0-9._+-]`、最多 23 字。**唔係 `v`**：`fw` 每次 release 都變，`v` 只喺 wire format 破格先變。
- R300 收到：**清空去重記錄**、標記「已 handshake」、回 ack。
- ⚠️ **R300 reboot 之後強制重新 handshake，有兩道：**
  1. **主動**：R300 未 handshake 時 `live` 帶 `hs:0`，已 handshake 嘅 micro:bit 一見到就重新 `hello`（~0.5 秒內）。所以就算學生冇撳任何嘢，R300 都好快知道對面行緊邊個 extension 版本。
  2. **保險**：R300 未收過 `hello` 就收到其他 `req` → 回 `nohs`。覆蓋 R300 啱 reboot、`live` 未到嗰 0.5 秒內送出嘅指令。
- 發送規則見第 8 節（1 秒重試、冇上限、ack 之前唔送其他嘢）。

### 9.3 `emo_set` —— micro:bit → R300（Phase 2a，**未實作**）

```
{"v":1,"id":1,"t":"req","op":"emo_set","p":{"emoji":"happy"},"ck":50}
```

- `emoji`：表情名，小寫 `[a-z0-9_]`、最多 16 字。R300 **只驗格式，唔驗名單**——名單由 extension 個 dropdown 把關。
- R300 將佢轉交顯示系統（同一條路轉去眼睛板），**唔會等眼睛板回覆**。
- 🔴 **`{"st":"ok"}` = R300 收咗並且轉發咗，唔等於眼睛板播到。**
- 表情**一直保持**，直到有新表情（或者 R300 自己狀態轉換）蓋過佢。
- 最長嘅名（`disconnected`，`id` 127）係 80 bytes。

### 9.4 `leg_set` —— micro:bit → R300（Phase 2b，**未實作**）

```
{"v":1,"id":42,"t":"req","op":"leg_set","p":{"rot":0,"fwd":100,"ms":1000},"ck":48}
```

- `rot`／`fwd`：**-100..100** 整數百分比；`ms`：**0..3000**。
- R300 **郁之前**就回 `ack`——ack 代表「收咗」，唔代表「郁完」。

### 9.5 `arm_set` —— micro:bit → R300（Phase 3，**未實作**）

```
{"v":1,"id":43,"t":"req","op":"arm_set","p":{"a1":100,"a2":50},"ck":178}
```

- `a1`／`a2`：兩隻手嘅 physical 角度 **0..180**（0 指前、90 向下、180 指後）。
- 🔴 **某隻手唔想郁 = 唔寫嗰個 key，唔可以寫 `0`。** `0` 係合法角度（指前）。

## 10. R300 開機

- RX task 起嗰陣先 `uart_flush_input()`，清走 R300 未 ready 之前囤住嘅過時訊息。Phase 2 之後尤其重要：一句 10 秒前嘅郁指令喺 R300 開完機先執行，部機會突然自己郁。（v0 時期實測：R300 一 ready 就有 11–12 條喺 100ms 內湧入。）
- 開機時 R300 **未 handshake**：micro:bit 下一句 `req` 會收到 `nohs`，自動重新 `hello`（第 9.2 節）。

## 11. Test vectors

兩邊實作都應該對住呢個表逐條驗。`bytes` 包埋 `\n`。

| 用途 | `ck` | bytes | 完整一行 |
|---|---|---|---|
| live req（R300 已 handshake） | 242 | 61 | `{"v":1,"id":128,"t":"req","op":"live","p":{"hs":1},"ck":242}` |
| live req（R300 未 handshake，例如啱 reboot） | 241 | 61 | `{"v":1,"id":128,"t":"req","op":"live","p":{"hs":0},"ck":241}` |
| live ack | 210 | 64 | `{"v":1,"id":128,"t":"ack","op":"live","p":{"st":"ok"},"ck":210}` |
| live fin | 109 | 62 | `{"v":1,"id":128,"t":"fin","op":"live","p":{"rtt":8},"ck":109}` |
| live badck ack | 137 | 77 | `{"v":1,"id":128,"t":"ack","op":"live","p":{"st":"err","e":"badck"},"ck":137}` |
| live badver ack | 8 | 76 | `{"v":1,"id":128,"t":"ack","op":"live","p":{"st":"err","e":"badver"},"ck":8}` |
| hello req（2a） | 97 | 66 | `{"v":1,"id":0,"t":"req","op":"hello","p":{"ext":"0.1.0"},"ck":97}` |
| hello ack（2a） | 131 | 76 | `{"v":1,"id":0,"t":"ack","op":"hello","p":{"st":"ok","fw":"1.0.0"},"ck":131}` |
| hello fin（2a） | 144 | 62 | `{"v":1,"id":0,"t":"fin","op":"hello","p":{"rtt":11},"ck":144}` |
| emo_set req（2a） | 50 | 70 | `{"v":1,"id":1,"t":"req","op":"emo_set","p":{"emoji":"happy"},"ck":50}` |
| emo_set ack ok（2a） | 164 | 65 | `{"v":1,"id":1,"t":"ack","op":"emo_set","p":{"st":"ok"},"ck":164}` |
| emo_set nohs ack（2a） | 30 | 76 | `{"v":1,"id":1,"t":"ack","op":"emo_set","p":{"st":"err","e":"nohs"},"ck":30}` |
| emo_set badarg ack（2a） | 199 | 79 | `{"v":1,"id":1,"t":"ack","op":"emo_set","p":{"st":"err","e":"badarg"},"ck":199}` |
| leg_set req（2b） | 48 | 83 | `{"v":1,"id":42,"t":"req","op":"leg_set","p":{"rot":0,"fwd":100,"ms":1000},"ck":48}` |
| arm_set req（3） | 178 | 73 | `{"v":1,"id":43,"t":"req","op":"arm_set","p":{"a1":100,"a2":50},"ck":178}` |

兩個必過嘅反例：
- **改一個 byte 一定要捉到**：`live req`（已 handshake）將 `"live"` 改做 `"livf"`，收方重新計出嚟**必須唔等於** `242`。
- **Payload 有 `,"ck":` 字串唔可以搵錯**：`{"v":1,"id":7,"t":"req","op":"say","p":{"m":",\"ck\":99"},"ck":114}`——收方搵**最後一個** `,"ck":` 必須讀到 `114` 兼驗證通過。（`say` 只係攞嚟測 parser。）

最長嘅訊息：`hello ack` 喺 `fw` 23 字、`id` 127 時係 96 bytes；`emo_set` 最長 80 bytes。全部離 127 仲有位。
