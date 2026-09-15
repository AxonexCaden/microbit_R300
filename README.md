# MicroBit ↔ R300 UART Link

用 MakeCode JavaScript（Static TypeScript）喺 BBC micro:bit 上面，做 R300 嘅 **v2 UART link**。

⚠️ **方向係 R300 主導。** micro:bit **唔會主動送任何嘢**：R300 開機之後每 500ms 發一次 `hello`，直到 micro:bit 答為止；handshake 成功之後 R300 就每 500ms 發 `live` 做連線檢查。micro:bit 淨係回應。下面係 2026-09-11 上機 capture 到嘅真實三段（**v1 原文**；v2 欄位對照見下面 Envelope）：

```
① R300 → micro:bit    {"v":1,"id":144,"t":"req","op":"hello","p":{"fw":"1.0.0"},"ck":86}
② micro:bit → R300    {"v":1,"id":144,"t":"ack","op":"hello","p":{"st":"ok","ext":"0.1.0"},"ck":96}
③ R300 → micro:bit    {"v":1,"id":144,"t":"fin","op":"hello","p":{"rtt":23},"ck":252}
   → R300 log: hello ack: ext=0.1.0 -> handshake ok on attempt 17 (23ms, fw=1.0.0); starting the live check
```

第 ② 段個 `ext`（v2 改名 `ex`）係關鍵：**佢載住一個只有 micro:bit 自己知、R300 估唔到嘅值**。R300 讀得到，就一次過證明「request 真係到咗」**加**「對面真係答得出」—— 唔係淨係電線通。（舊版要靠額外一段 `diag_ack` 才做到呢件事，而家 handshake 自己就帶住。）

✅ **兩邊一齊上機驗證過**：handshake 成功、`ext=0.1.0` 讀到、`live` **11/11 成功**、rtt 全部 14ms、間隔 510ms、零 LOST。詳見下面「實測紀錄」。

**呢個 project 已經由 MicroPython 轉咗做 MakeCode JavaScript，唔再用 `.py`。**

## 點解轉咗用 JS，唔用 MicroPython

1. **JSON 支援**：查實咗 [pxt-microbit 個 `libs/core/pxt.json`](https://github.com/microsoft/pxt-microbit/blob/master/libs/core/pxt.json)，`json.ts` 係 core package 一部分，`JSON.stringify()`/`JSON.parse()` 開箱即用。反觀 micro:bit 嘅 MicroPython firmware（[mpconfigport.h](https://github.com/microbit-foundation/micropython-microbit-v2/blob/v2.1.1/src/codal_port/mpconfigport.h)）淨係編譯咗 `machine`/`time`/`random`/`errno`，連 `json`、`ujson`、`struct` 都冇——之前個 `.py` 版本要手寫 string 砌 JSON。
2. **冇咗「UART 卡死 USB」嘅問題**：MicroPython 版本一行 `uart.init(tx=pin0, rx=pin1)` 就會將 REPL 用緊嗰條 UART 搶走去 P0/P1，USB 連接即刻斷晒，之後每次想再傳新程式都要重燒成個 firmware 先攞返控制權（呢個問題成個 session 撞咗好多次）。JS 版本每次部署都係透過燒一個全新編譯好嘅 `.hex`（經 DAPLink，同板上行緊咩程式完全冇關係），唔會再有呢個死症。

## Hardware Spec

呢個 project 用嘅係 **BBC micro:bit V2**。

| 項目 | 規格 |
|---|---|
| 型號 | BBC micro:bit V2 |
| MCU | Nordic nRF52833（Arm Cortex-M4F，64 MHz） |
| Flash | 512 KB |
| RAM | 128 KB |
| 感應器 | 加速度計、電子羅盤（磁力計）、麥克風、喇叭、觸控 logo |
| 顯示 | 5×5 LED 矩陣 |
| 按鈕 | Button A / Button B |
| 無線 | Bluetooth 5.0 (BLE)、2.4 GHz Radio、NFC |
| 連接 | Micro USB、Edge connector（25 pins）、JST 電池座 |
| Debug 介面 | DAPLink (CMSIS-DAP)，經 USB 提供 MSD + CDC (serial) + HID |

本機實際偵測到嘅 board：
- **Unique ID**: `99063602000528205a022add0902c1b9000000006e052820`（開頭 `9906` 表示 V2 硬件）
- **DAPLink Interface/Bootloader Version**: `0257`

### 關於 P0 / P1（UART TX/RX）

**P0 唔係硬件定死嘅 TX，P1 都唔係硬件定死嘅 RX**——呢個係軟件揀嘅，`serial.redirect()` 想指定邊隻 pin 都得，nRF52833 嘅 UARTE 可以配置去幾乎任何 GPIO。

呢個 project 用 `serial.redirect(SerialPin.P0, SerialPin.P1, BaudRate.BaudRate115200)`：
- 冇 call 呢個 function 之前，serial 預設行**內部 USB-UART**（同 `console.log`/USB serial 同一組線）
- Call 咗之後，serial 轉去 **P0（TX）/ P1（RX）**，駁去 R300（P0 → R300 GPIO21，P1 ← R300 GPIO10）
- **開機撳住 Button A 就會跳過 redirect，留喺 USB**——呢個係我哋自己加落 `r300.ts` 嘅 dev 用逃生門，等你唔使成日重燒 firmware 都可以睇 log／再部署

✅ **P0/P1 ↔ GPIO21/GPIO10 呢個配對已經喺 R300 自己嘅開機 log 度得到確認**（本機 capture 咗一句，就係下面呢句）：
```
I (83) MicrobitLink: ready: port=0 tx=10 rx=21 baud=115200
```
即係 R300 呢邊 UART port 0：TX=GPIO10（接落 micro:bit 嘅 P1/RX），RX=GPIO21（收 micro:bit 嘅 P0/TX）。同我哋 `r300.ts` 個 comment 一致，唔再係淨係睇 `aimo_v1_edu_microbit_board.cc` 個 comment 推測。

## R300 係咩

由 R300 自己個 `idf_monitor.py` 開機 log 確認咗（喺 R300 側邊嘅 ESP-IDF project `CompanionRobots` 度 capture 出嚟，唔喺呢個 repo 入面；本機嗰份 `Log.txt` 已經加入 `.gitignore`，所以 clone 落嚟係冇嘅）：

| 項目 | 資料 |
|---|---|
| Project name | `xiaozhi`（App version 1.0.0） |
| 晶片 | ESP32-S3（octal PSRAM 8MB） |
| Board SKU | `aimo-v1-edu-microbit` |
| Character pack | `floki-edu-microbit`（wake word `hi FLbKm`） |
| MAC | `e0:72:a1:cc:d5:80`（同 `mpremote connect list` 見到嘅 `1101` port 一致） |
| 螢幕/其他硬件 | ST7796 480×272 LCD、ES8311/ES7210 音頻 codec、鏡頭（呢部無鏡頭，probe failed）、WiFi |

即係話 R300 唔止係一條 UART 線咁簡單，佢係一部完整嘅 **AI 陪伴機械人**（有 chassis 移動控制、螢幕表情、語音），micro:bit 淨係佢好多 UART 連接埠（`port=0`）入面其中一個，仲有 `port=1`（`MonEmotion`，控制表情顯示）同 `port=2`（Motor UART，控制馬達）。

## 通訊協定

```
micro:bit (P0 TX) ──────────→ R300 (GPIO21 RX, UART port=0)
micro:bit (P1 RX) ←────────── R300 (GPIO10 TX, UART port=0)
              共用 UART, 115200 baud, 8N1
```

每行係一個完整 JSON object 加一個 `\n`，**只准 ASCII**，唔准有空白，每行最多 **253 bytes**（R300 個 line buffer 係 `char buf[254]`，超長嘅行會成行靜靜哋丟棄，冇 log、冇 ack）。

📖 **完整合約喺 [`protocol.md`](protocol.md)，衝突以嗰份為準**；下面只係摘要。

### Envelope

```
{"v":2,"s":"r300","id":0,"t":"r","op":"hello","p":{"fw":"1.0.0"},"ck":126}
```

| 欄位 | 意思 |
|---|---|
| `v` | Protocol 版本（而家 `2`）。**淨係 handshake 嘅行（`hello` 三行／badver 回覆）先帶**，其他行一律冇；**只喺 wire format 有 breaking change 先變**，唔係 firmware 版本 |
| `s` | Sender tag：`r300` 或 `mb`。收方**最優先**丟棄自己 tag 嘅行（防 RX 浮空時聽到自己 echo —— 見下面「點解要 envelope」） |
| `id` | 關聯 ID。兩邊生成都係 **0–99**（解析器照收 0–255）；回覆原封 echo 返發起方嗰個 |
| `t` | 邊一段：`r`（request）/ `a`（ack）/ `f`（fin） |
| `op` | 種類（見下） |
| `p` | Payload，冇內容都要寫 `{}` |
| `ck` | 校驗碼，**一定係最後一個欄位** |

### `ck` 點計

**全部 byte 加埋 mod 256**，而且係**對收到嘅 bytes** 計，唔係 parse 完再砌返出嚟：

1. 發送方砌好冇 `ck` 嘅 object → 計 checksum → 喺最後嗰個 `}` 前面插 `,"ck":N`
2. 收方搵**最後一個** `,"ck":`（payload 內含呢串字都唔會搵錯）→ 剷走到尾、補返一個 `}` → 重新計、同讀到嘅數比

⚠️ 舊版係 `sum(text) % 256`（對字串計），v1 係對**收到嘅行**計，所以 payload 有 escape（例如 `\"`）嘅時候兩者唔同。8-bit checksum 有 1/256 撞嘅機會；將來加 `*_get` 攞真數值就要升 16-bit（即係升 `v`）。

### 三段同 `op`

```
發起方 ──r──→ 對方
發起方 ←──a── 對方      對方收到 r 之後回
發起方 ──f──→ 對方      發起方收到「最終」a 之後回（`p` = `{"rt":N}`）
```

- **邊個發 `r`，邊個負責發 `f`**；🔴 **任何人都唔准回覆 `a`／`f`**（會 ping-pong 到永遠）。
- 錯誤碼：`badck`（**✅ 用同一個 `id` 重試**）、`badver`（**handshake 收到用 1 秒慢拍重試**，唔再即死）、`noop`、`badarg`（呢兩個 ❌ 唔重試）。
- **去重**：收方記住上一個處理過嘅 `(id, op)` 同當時回嘅 ack 原文，撞正就重播、唔重新執行 —— 因為 ack 途中爛咗，對方會用同一個 `id` 重送，唔去重就會執行兩次。

| `op` | 方向 | 狀態 |
|---|---|---|
| `hello` | R300 → micro:bit | ✅ 兩邊都實作。R300 每 500ms 發到有 ack 為止；micro:bit 回 `{"st":"ok","ex":"0.1.0"}` |
| `live` | R300 → micro:bit | ✅ 兩邊都實作。handshake 成功之後才開始，micro:bit 回 `{"st":"ok"}` |
| `vol_done` | R300 → micro:bit | ✅ 兩邊都實作。R300 確認音量真係落咗，值喺 `p.vl` |
| `mcp_done` | R300 → micro:bit | ✅ 兩邊都實作。R300 確認段舞註冊咗，帶 `name`／`steps`／`drop`。⚠️ **R300 只發一次、唔重試**（音量點都落咗、條 link 生唔生存係 `live` 話事），所以 micro:bit 收唔到就係永久失去嗰次嘅兩個數 |
| `emo_set` | micro:bit → R300 | ✅ 兩邊都實作（`r300.emoji()`）。monitor 眼睛板嘅面 |
| `leg_set` | micro:bit → R300 | ✅ 兩邊都實作（`r300.motor()`）。車輪 |
| `arm_set` | micro:bit → R300 | ✅ 兩邊都實作（`r300.arm()`）。兩隻手 |
| `vol_set` | micro:bit → R300 | ✅ 兩邊都實作（`r300.volume()`）。喇叭音量 0..100 |
| `mcp_desc` | micro:bit → R300 | ✅ 兩邊都實作（`r300.describe()`）。替錄影改名同描述 |
| `mcp_take` | micro:bit → R300 | ✅ 兩邊都實作（`r300.takeStart()`／`r300.takeFinish()`）。開始錄／收貨 |

### 點解要 envelope（v0 嘅三個死症）

v0 係裸 JSON（`{"MB_cmd":"test","checksum":192}`）加一個內容 hash 做 checksum，結果：

1. **配錯 request 同 reply**。R300 開機慢過 micro:bit ~12 秒，micro:bit 囤住嘅 12 句會喺 100ms 內一次過倒晒出嚟；12 個 ack 嘅 checksum 全部一樣（內容相同 → hash 相同），micro:bit **根本分唔到邊個 ack 對應邊個 request**。如果係唔同指令就會靜靜哋配錯 → v1 加 `id`。
2. **冇 session 邊界**。reboot 之後唔知對面係邊個 session → v1 用 R300 收到 `hello` 個 ack 嚟清空去重記錄。
3. **冇空間講「我唔識」**。v0 撞到唔識嘅 `cmd` 只可以靜靜哋丟 → v1 有 `noop`／`badarg`／`badver`，而且 `v` 唔夾會明講（仲有一個例外處理，見 `protocol.md` 第 7 節 #3，因為對方回 `badver` 嘅時候用緊佢自己個 `v`）。

另外，v0 嗰個 `diag_ack` 想證明「reply 真係返到 micro:bit」，v1 用一個更便宜嘅等價物：**`hello` 個 ack 帶住 micro:bit 自己嘅 `ex`**（v1 嗰代叫 `ext`），R300 讀到就證明兩件事同時成立。⚠️ 加 ack 嘅時候要留意：只係 echo 返 R300 送咗嘅嘢嘅 ack，量度到嘅係電線，唔係對面。

### 🔴 一定要加大 serial buffer（MakeCode 預設得 20 bytes）

`connect()` 入面喺 `serial.redirect()` 之後即刻做咗兩句，**唔可以刪**：

```ts
serial.setRxBufferSize(254)
serial.setTxBufferSize(254)
```

**點解**：MakeCode 個 serial RX/TX buffer **預設各得 20 bytes**，但呢條線上面最短嘅協議行已經超過 50 bytes——最短嘅 ack `{"s":"mb","id":0,"t":"a","op":"live","p":{"st":"ok","id":42},"ck":85}` 就係 **69 bytes**（`\n` 唔計），最長嗰條（`hello` ack 帶 23 字 `ex`、`id` 99）去度 **101 bytes**。20 bytes 裝唔落，個 ring buffer 喺 `\n` 到達之前就已經捲咗一轉——`serial.readLine()` 攞返嚟嘅係截斷咗嘅尾段，連 `"t"` 呢個 key 本身都已經俾沖走，所以 `handleLine()` 永遠收唔到一條完整嘅行。

⚠️ **佢個失敗症狀係「完全冧聲」**——唔係亂碼、唔係 checksum 唔啱、`onDataReceived` 睇落好似完全冇 fire 過。喺 R300 個 log 度睇落，同「實體回程線 `P1 ← GPIO10` 根本冇駁」**一模一樣，分唔到**。

揀 254 係因為 R300 嗰邊 `MicrobitLink` 個 RX 行上限同樣係 254 bytes（合約上限 253）。亦係 MakeCode 文檔寫嘅上限（256 會 error），再細就裝唔落 `hello` 個長 ack。

## `r300.ts` 提供咩 Block？

**學生喺 Blocks 畫面見到嘅係各 namespace**（`R300 Movement`／`R300 Hands`／`R300 Emotion`／`R300 Speaker`／`R300 MCP`）—— 五個都係同一個橙色 `#E67E22`，namespace 內部再用 `//% groups` 分小組；下面呢節係內部 `r300.*` API —— 而家全部 `blockHidden`，淨係 TypeScript call 得到。

學生 block 一覽：

| Namespace | Blocks（group） |
|---|---|
| `R300 Movement` | `move forward for [1] seconds`／`move backward for [1] seconds`（1–3 秒，`Move`）、`move left`／`move right`（無得填，固定 1 秒原地轉，`Turn`）、`stop driving now`（`Stop`）、`drive rot [0] fwd [50] for [1000] ms`（`Custom` —— 保留原本嘅 rot／fwd／ms 全手動控制） |
| `R300 Hands` | `move left hand [up]`（`Left Hand`）／`move right hand [up]`（`Right Hand`）／`move both hands [up]`（`Both Hands`）、`move hands to [90] and [90] degrees`（`Custom` —— 保留原本嘅 a1／a2 手動控制，-1 = 唔郁嗰隻手） |
| `R300 Emotion` | `show face [happy]`（`Emotion Control`） |
| `R300 Speaker` | `set speaker volume to [50]`（`Audio Actions`） |
| `R300 MCP` | `describe this routine as …`／`start recording moves`／`finish recording as an AI tool`（`MCP Setup`） |

⚠️ 手嘅 dropdown 三隻值係 **up = 180°、down = 90°、back = 0°**（跟 `pxt-axonex_test` 個 `HandPosition`）。**2026-09-15 確認：高舉（high five 個 offer）＝ `up`（180°）**，`test_mcp_high_five.ts` 就係用呢個。`protocol.md` 9.5 用「0 = 指前、90 = 向下、180 = 指後」描述同一條 range——兩套叫法指緊同一批數字，唔好兩邊撈亂。

| Block | TypeScript | 用途 |
|---|---|---|
| ~~`connect to R300`~~ | `r300.connect(): void` | **唔再係 block**：extension 開機自動 connect（`r300.ts` 最底嘅 top-level `r300.connect()`，行喺任何 `on start` 之前）。有 guard，重複 call = no-op。Redirect serial 去 P0/P1、加大 buffer、註冊 RX handler 都喺入面 |
| `show face [happy]` | `r300.emoji(e): string` | 喺 monitor 眼睛板顯示一個表情。19 個名（happy / sad / angry / …），只可以喺下拉揀。學生版本係 `r300_emotion.showFace` |

⚠️ 學生 block（`r300_movement.moveForward` 等）特登回 `void`：有回傳值嘅 function 喺 Blocks 畫面會變成橢圓形 reporter block，只可以插入其他 block 個窿，**拖唔入 `on start`**。內部 `r300.*` 特登有回傳值（`"ok"`／`"timeout"`…），所以更加唔會出 block。

**其餘 8 個係 TypeScript function —— 有 `//%` 但全部 `blockHidden=true`，所以 Blocks 畫面唔會見到。** 佢哋係完整嘅 API（唔係「寫嚟試用」），但要用就要喺 MakeCode 切去 JavaScript 打：

| Function | 做咩 |
|---|---|
| `r300.motor(rot, fwd, ms): string` | 腿。`rot`／`fwd` = -100..100（100 = 全速）、`ms` = 0..3000。兩者都 0 = 停車 |
| `r300.stopNow(): string` | ⚠️ 停車，同 `motor(0,0,0)` **唔同**：佢會打斷仲喺飛嘅 request。`motor(0,0,0)` 撞正有 request 飛緊嘅時候會**靜靜哋回 `"busy"` 而一個字都唔發**，車繼續行 —— 所以應急停車一定要用呢個 |
| `r300.arm(a1, a2): string` | 手。`a1` = 右手、`a2` = 左手，physical 0..180（0 指前、90 向下、180 指後）；傳 **-1 = 唔都嗰隻手** |
| `r300.volume(v): string` | 喇叭音量 0..100。R300 另發 `vol_done` 確認真係落咗，個值喺 `r300.lastVolume`（**唔係**你要求咗嗰個 —— 兩個係唔同嘅聲明） |
| `r300.describe(name, desc): string` | 錄影之前改名同描述。名 1-16 字 `[a-z0-9_]`；**同名再叫 = 描述接落去**，所以長描述分幾句 send（每次 ≤ 34 字） |
| `r300.takeStart(): string` | 開始錄。名要事先 `describe()` 過 |
| `r300.takeFinish(): string` | 收貨，R300 註冊成 MCP tool，之後 AI 叫得郁個名 |
| `r300.send(op, pJson): string` | 通用版，自己砌 payload |

**連接狀態：**

| 變數 | 意思 |
|---|---|
| `r300.liveCount` | **本 session** 內 R300 答過幾多次 `live`。**> 0 = 今個 session 握手真係完成、條 link 通咗。** R300 收到 `hello` 嘅 ack 之後先開始 `live`，所以見到 `hello` 只代表握手**開始**咗，見到 `live` 才代表**完成**。⚠️ 每次新 session 會**歸零**——R300 每次 reboot 都會重新握手，所以呢個數一定要「今次 session 由 0 爬返上 > 0」，唔可以當佢係一個由頭到尾都唔跌嘅累計數 |
| `r300.sessionEpoch` | **R300 開過幾多次 handshake**（由 0 開始）。`test.ts` 嘅自動掃描就係 key 喺呢個數：**每個 session 掃一次**。⚠️ 佢係「handshake 次數」而唔係「session 次數」—— 如果 handshake 期內有 ack 掉咗而 R300 重發 `hello`，就會 +多過 1。對個閘冇影響（只係比 `!=`），但唔好當佢係準確嘅 session 計數 |
| `r300.SESSION_ID` | 呢次開機隨機抽嘅 id（1..99；約 1% 撞，見 protocol.md 7.2）。只會出現喺 `live` ack payload 嘅 `id` 欄位，用途係等 R300 知道 micro:bit 自己 reset 咗（protocol.md 7.2）。學生寫嘢唔使理佢 |

⚠️ **點解要分 session，唔係「上電做一次」就算**：R300 每次 reboot 都會重新握手（**包括每次開 monitor —— 一開 port 就 reset 佢**），而 micro:bit 係唔會跟住 reset 嘅。任何「只做一次」嘅嘢如果認「上電」，就會喺 R300 之後每一次 reboot 面前坐喺度唔做嘢——一個真嘅 regression 就係咁靜靜哋過咗。

判別「邊個 `hello` 係新 session」唔可以靠「見到 `hello`」，因為 R300 每 500ms 就重發一次直到收 ack。`protocol.ts` 用嘅規則係：**R300 一收到 ack 就會離開 handshake 階段，所以「自己已經 ack 過一次之後再收到 `hello`」就必定係新 session**。靠「有冇 `live` 過」係唔夠嘅 —— R300 開咗 session 但未及發第一條 `live` 就 reboot 嘅話，嗰個 session 就會漏掉。

⚠️ **自動掃描特登唔郁車輪**（`protocolSweep(false)`）：R300 每次 reboot／每次連線抖動都會開新 session，即係每次都會重新觸發掃描 —— 如果自動版會郁，部車就會喺冇人掂過嘅情況下自己行。第 2 步（唯一一步會畀電嘅）喺自動模式改送停車，`leg_set` 個 op、ack 同 motor board UART 照樣驗到。想睇真嘅向前行就**按住 B 一秒**跑完整版。

**錄完之後嘅結果喺三個變數（R300 經 `mcp_done` 報返）：**

| 變數 | 意思 |
|---|---|
| `r300.lastTakeName` | 註冊咗嘅名 |
| `r300.lastTakeSteps` | 錄到幾多步 |
| `r300.lastTakeDrop` | 🔴 **掉咗幾多步。** R300 上限 64 步，超出嘅會照樣即時執行但**唔會錄入去**。呢個數 > 0 就代表段舞係**截斷咗**，而 micro:bit 側冇第二個地方睇得到 |

⚠️ `describe()` 同兩個 `take*()` 係**分開三粒**，唔係一個 blocking `record()`：每次 `send()` 要等 R300 個 ack（最多 1.5 秒），而你要做動作嘅時間係喺 start 同 finish **之間**。`test.ts` 嘅 logo 長按就係示範呢個流程。

回傳值係 R300 答乜：`"ok"`／`"badarg"`／`"noop"`／`"badver"`／`"busy"`／`"timeout"`／`"long"`（行太長，唔會送出）／`"stopped"`（被 `stopNow()` 打斷）。🔴 **`"ok"` 只代表 R300 收咗，唔代表已經做咗** —— 呢條 link 上面根本睇唔到物理結果。

```ts
input.onButtonPressed(Button.A, function () {
    basic.showString(r300.motor(0, 50, 1000))   // 半速向前 1 秒，結果顯示喺 LED 矩陣
})
```

⚠️ **函數名同參數係最終嘅，但個 sender 內部仲係暫時形狀**：佢係**阻塞式**（`basic.pause(1)` polling，最多等 3 × 500ms），所以 `motor()` 一叫就會佔住成個 fiber 最多 1.5 秒，而且**一次只可以有一個 request 飛**（撞正就回 `"busy"` —— 就係上面 `stopNow()` 存在嘅原因）。最終應該係背景 fiber + 最新取代，但嗰個係 Phase 5 嘅嘢，唔影響而家嘅合約。傳送規則已經跟足：一次一個 request、每次新 `id`、超時／`badck` 用**同一個 `id` 重送**（所以 R300 分得出係重送、唔會郁兩次）。

⚠️ 舊版嗰四個 block（`sendMessage`／`testLink`／`controlMotor`／`isConnected`）建基於 v0，已經拆唨。

⚠️ `connect()` 回傳 `void`（舊版回 `R300Link`）—— **特登嘅**：有回傳值嘅 function 喺 Blocks 畫面會變成橢圓形 reporter block，只可以插入其他 block 個窿，拖唔入 `on start`。

`test.ts` 淨係一句 `r300.connect()`，而且喺 `pxt.json` 列做 `testFiles`——只會喺呢個 repo 自己做 top-level project build 嗰陣先 compile，學生 add extension 嗰陣唔會跟入去。

## Software Version

| 工具 | 版本 |
|---|---|
| pxt CLI | 全域裝 `npm install -g pxt` |
| pxt-microbit target | v9.1.1 |
| pxt-core | v13.0.1 |
| Node.js | v25.2.1 |
| npm | 11.6.2 |

## Project 結構

```
microbit_R300/                    ← repo root 本身就係 MakeCode extension
├── pxt.json                      ← extension manifest（dependencies: core / radio / microphone）
├── protocol.md                   ← 📖 v2 wire format 合約（**唯一真相來源**）
├── protocol.ts                   ← 協議層：ck 驗證、envelope 分派、砌回覆
├── r300.ts                       ← ⭐ library：內部 `r300` namespace（hidden）+ 學生 block namespaces；開機自動 connect
├── test.ts                       ← 本機測試（`testFiles`，唔會跟去學生 project）
├── test_2.ts                     ← bench 測試：copy 去 MakeCode 出 blocks 用（唔喺 pxt.json）
├── test_mcp_high_five.ts         ← high_five 錄影示範：只用學生 block（copy 去 MakeCode 出 blocks 用）
├── test_emotion.ts               ← 表情巡禮示範：撳 A 順序出晒 19 個面，每個停 5 秒 + micro:bit beep 一聲
├── tsconfig.json                 ← pxt build 用（pxt 自動生成）
├── package.json                  ← 釘住 pxt-microbit target 版本（+ package-lock.json）
├── README.md                     ← 同時係 MakeCode extension 說明頁
├── .gitignore
├── legacy/
│   └── main.py                   ← ⚠️ 舊 MicroPython 版本，已棄用，淨係留返做歷史記錄
├── Log.txt                       ← 本機 capture 嘅 R300 monitor log（唔 commit）
├── node_modules/                 ← ⚠️ 544 MB，pxt-microbit target 檔案（唔 commit）
├── pxt_modules/                  ← 安裝落嚟嘅 dependencies（唔 commit）
└── built/
    └── binary.hex                ← build 出嚟嘅嘢，flash 呢個（唔 commit）
```

## Version Control

Repo：**https://github.com/kenny-wong-axonex/microbit_R300**（公開版；舊 `AxonexCaden` 係原本 repo）

Clone 落嚟只有 ~9 個檔案、~400 KB，因為所有生成物都已經 gitignore：

| 唔 commit 嘅嘢 | 大細 | 點解 |
|---|---|---|
| `node_modules/` | 544 MB | pxt-microbit target 本身，clone 完自己 `pxt target microbit` 裝返 |
| `pxt_modules/` | ~1 MB | `pxt install` 自動裝返 |
| `built/` | ~3 MB | `pxt build` 生成 |
| `.vscode/` | 幾百 B | pxt 生成嘅本機 editor 設定，開一次 folder 就會自動重新生成 |
| `Log.txt` | — | 本機 capture，唔屬於 source |

想連 `built/binary.hex` 都 commit（方便人唔使裝 toolchain 都 flash 到）嘅話，將 root `.gitignore` 嘅 `built/` 改成 `built/*` + `!built/binary.hex` 就得——以前要同時改埋一個 pxt 自動生成嘅嵌套 `.gitignore`，搬去 repo root 之後已經冇咗嗰個檔。

Library 同 demo 分開兩個檔：`r300.ts` 係 extension 本體（`r300` namespace），`test.ts` 係本機測試，淨係一句 `r300.connect()`。`test.ts` 喺 `pxt.json` 列做 `testFiles`——只會喺呢個 repo 自己做 top-level project build 嗰陣先 compile，學生 add extension 嗰陣唔會跟入去。

## corepkg 支援咩 library？

`core` 呢個 package（`pxt.json` 個 `"dependencies": {"core": "*"}`）**每個 micro:bit MakeCode project 都必然帶埋**，唔使自己加。內容對應 [`pxt-microbit` repo 嘅 `libs/core/pxt.json`](https://github.com/microsoft/pxt-microbit/blob/master/libs/core/pxt.json) 個 files list，實際可以用嘅 namespace／class 有：

| Namespace / Class | 對應源碼 | 用途 |
|---|---|---|
| `basic` | basic.ts/cpp | `basic.forever()`、`basic.pause()`、`basic.showString()`、`basic.showIcon()` 等主 loop / LED 顯示 |
| `input` | input.ts/cpp | 按鈕（`input.buttonIsPressed`）、搖晃/手勢（`input.onGesture`）、觸控 pin |
| `control` | control.ts/cpp | `control.inBackground()`、event bus、`control.reset()` |
| `led` | led.ts/cpp | LED 矩陣底層控制（`led.plot`、`led.toggle`） |
| `music` | music.ts/cpp, melodies.ts | 播音樂、`music.playMelody()`，內建 melody 庫 |
| `pins` | pins.ts/cpp | Digital/analog I/O（`pins.digitalReadPin`、`pins.analogWritePin`） |
| `serial` | serial.ts/cpp | UART（`serial.redirect`、`serial.writeLine`、`serial.readLine`）——我哋 project 用緊嗰個 |
| **`JSON`** | json.ts | `JSON.stringify()` / `JSON.parse()`——我哋 project 用緊嗰個 |
| `buffer` / `Buffer` | buffer.ts/cpp | Binary buffer 操作 |
| `images` / `Image` | images.cpp, icons.ts | LED 矩陣圖案（`IconNames`、自訂 `Image`） |
| `game` | game.ts | 簡易計分/遊戲工具（`game.score`） |
| `Math` | math.ts, advmath.cpp, trig.cpp, fixed.ts | 數學運算，包括三角函數 |
| `console` | console.ts | `console.log()`（主要喺瀏覽器 simulator 用，真機冇畫面顯示） |
| `light` | light.cpp | 用 LED 矩陣做光線感應（原理係 LED 反向做 light sensor） |
| `logo` | logo.cpp | Touch logo（V2 專有，電容式觸控） |
| `soundExpression` | soundexpressions.ts/cpp | V2 喇叭嘅內建音效（`music.playSoundEffect`） |

**呢啲唔算 library，係內部 build/GC 機制**（唔會直接用到）：`gc.cpp`、`controlgc.cpp`、`perfcounters.ts`、`gcstats.ts`、`interval.ts`、`poll.ts`、`controlmessage.ts`、`templates.ts`。

### 想用多啲功能？呢啲要自己加落 `pxt.json` 先有（唔係 corepkg 自動帶）

`pxtarget.json` 嘅 `bundleddirs` 仲有呢幾個現成 package，但要自己喺 `pxt.json` 嘅 `dependencies` 加先會編譯落去（我哋個 `pxt.json` 帶埋 `radio` 同 `microphone`，code 冇用到但係**特登保留**——剷走會令 build 卡死喺雲端 compile，見「點 Clone 同 Build」嗰個 ⚠️）：

`radio`（micro:bit 之間 2.4GHz 通訊）、`bluetooth`、`servo`、`microphone`（V2 咪高峰）、`datalogger`（用 `MY_DATA.HTM` 嗰個內建 data logging 功能）、`flashlog`、`bitmap`、`fonts`、`color`、`audio-recording`、`audio-samples`、`settings`。

## 點 Clone 同 Build

首次設置（一次性）：
```bash
git clone https://github.com/AxonexCaden/microbit_R300.git
cd microbit_R300

npm install -g pxt        # pxt CLI，全域裝一次就夠

npm install               # 裝返 pxt-microbit target（~544 MB，所以要等一下）
pxt target microbit
pxt install               # 裝 pxt_modules（core / radio / microphone）
```

之後每次改完 `r300.ts` / `test.ts`，喺 repo root build：
```bash
pxt build
```
成功嘅話 `built/binary.hex` 會更新。

⚠️ **`pxt.json` 嘅 `radio` / `microphone` 睇落冇用，但唔好剷。** pxt-microbit 只替固定幾個 dependency 組合預先 compile 咗 native hex（`node_modules/pxt-microbit/built/hexcache/`，得 4 個）。`core + radio + microphone` 係 `pxt init` 預設組合，命中 cache，build 幾秒完成；剷走佢哋就冇預製 hex，pxt 會改去叫 Microsoft 雲端 compile，實測卡死喺一條 HTTPS request 超過 5 分鐘都唔返。

## 點 Flash

⚠️ **`pxt deploy` 喺呢部 macOS 版本（Sequoia）有已知 bug，唔穩定，唔好用。** 改用最原始、最穩陣嘅方法——**喺 Finder 直接拖個 build 好嘅 `.hex` 落 `MICROBIT` 磁碟機**（DAPLink 經 SWD 燒，同板上行緊咩程式完全無關，一定成功）。

⚠️ **唔好用 `cp`。** `cp built/binary.hex /Volumes/MICROBIT/` 會**直接 block 住唔返，而且一個 byte 都冇寫入**——2026-09-11 實測：`cp` hang 超過 20 秒，kill 咗之後 `ls /Volumes/MICROBIT/` 只有 `DETAILS.TXT`／`MICROBIT.HTM`／`MY_DATA.HTM`，冇 `binary.hex`。呢隻碟係 `msdos` + macOS 新嘅 `fskit`（`mount` 顯示 `(msdos, local, nodev, nosuid, noowners, noatime, fskit)`），對 DAPLink 呢種細 FAT 卷嘅 write 經常卡死。（以前 README 寫「多數已經燒咗入去」係錯嘅——最好校驗方式係 copy 完再 `ls` 一次，見到 `binary.hex` 才算。）

拖完等幾秒，board 會自動 flash 同重新掛載。⚠️ **成功與否看有無 `FAIL.TXT`**：DAPLink 燒失敗會在碟上留一個 `FAIL.TXT`，寫明原因；冇呢個檔就是成功。

## 點睇 Log

因為 `r300.ts` 預設會將 serial redirect 去 P0/P1，睇 log 分兩種情況：

**情況一：正常運作（睇 R300 收到啲乜）**

用 `mpremote connect list` 或者 `ls /dev/cu.*` 搵 R300 個 port（USB descriptor 會顯示 `Espressif USB JTAG/serial debug unit`），然後：
```bash
mpremote connect /dev/cu.usbmodem1101 repl
```
或者用 `screen`：
```bash
screen /dev/cu.usbmodem1101 115200
```
（`screen` 退出：`Ctrl-A` 再撳 `K` 確認；`mpremote repl` 退出：`Ctrl-]`）

**情況二：Dev 模式（開機撳住 Button A，留喺 micro:bit 自己 USB）**

搵返 micro:bit 個 port（USB descriptor 會顯示 `Arm BBC micro:bit CMSIS-DAP`）：
```bash
mpremote connect /dev/cu.usbmodem1102 repl
```
呢個模式冇 R300 都可以直接睇到 micro:bit 自己 print 緊乜。⚠️ **但 micro:bit 側一句都唔會 print**（協議層冇 log，而且冇 console 可以睇）——所以呢個模式現在嘅用途只剩「確認 redirect 冇發生」同埋將來加 debug log 嘅時候用。要睇它收咗／回咗乜，唯一嘅地方係 **R300 那邊**（見情況一）。

⚠️ **兩部裝置都會顯示做 `/dev/cu.usbmodemXXXX`，port number 拔插之後可能會變** —— 千祈唔好用 `mpremote connect auto`，多過一個裝置嘅時候佢會揀錯。用 `mpremote connect list` 先查實邊個 port 對應邊部裝置（睇 USB descriptor 嗰欄），再用明確 port 連接。

## 實測紀錄（2026-09-11，micro:bit + R300 兩邊一齊燒）

手動驗證方式：燒好兩邊之後，開 R300 個 `idf_monitor`，睇 R300 嗰邊出咩（以下係 2026-09-11 **v1** 原文）：

```
I (14803) MicrobitLink: port=0 rx start: flushed 0 stale bytes
I (14803) MicrobitHello: probing every 500ms (ack timeout 300ms); the live check starts once it answers
W (15113) MicrobitHello: no hello ack from the micro:bit (nothing listening?)      ← 第一次 probe 唔通
I (22923) MicrobitLink: port=0 <- {"v":1,"id":144,"t":"ack","op":"hello","p":{"st":"ok","ext":"0.1.0"},"ck":96}
I (22923) MicrobitHello: hello ack: ext=0.1.0 -> handshake ok on attempt 17 (23ms, fw=1.0.0); starting the live check
I (22923) MicrobitLive: started: period 500ms, ack timeout 300ms, LOST after 3 misses
I (22923) MicrobitLive: micro:bit ONLINE (id=-1, traffic)                          ← idle-skip：啱啱條 hello fin 經過
I (23423) MicrobitLink: port=0 -> {"v":1,"id":128,"t":"req","op":"live","p":{},"ck":104}
I (23433) MicrobitLink: port=0 <- {"v":1,"id":128,"t":"ack","op":"live","p":{"st":"ok"},"ck":210}
I (23433) MicrobitLink: port=0 -> {"v":1,"id":128,"t":"fin","op":"live","p":{"rtt":14},"ck":154}
```

| 項目 | 結果 |
|---|---|
| `hello` handshake | ✅ 兩次開機（boot 1 attempt 17、boot 2 attempt 30）都成功，兩次都讀到 `ext=0.1.0` |
| `live` check | ✅ **11 條 req → 11 條 ack → 11 條 fin**，零 miss |
| `live` rtt | **全部 14ms**（11/11 條一模一樣；hello 嗰兩條係 23ms（開機 1）／17ms（開機 2）） |
| `live` 間隔 | **510ms**（500ms 週期 + 約 10ms 處理），開機 1 嗰個 2.5s 空隙係 R300 自己 reboot |
| `LOST` | **0 次**。（`LOST` 呢兩個字喺 log 出現過 2 次，但兩次都係開機 banner 句 `started: period 500ms, ack timeout 300ms, LOST after 3 misses`，唔係真事件——`grep -c LOST` 會呃你。） |
| 延長測試 | 開機 1 得 1 條（之後 R300 自己 reboot），開機 2 連續 10 條跨 4.6 秒。**未做過分鐘級長時間跑** |
| ⚠️ 第一次應機要 8–11 秒 | 呢個係**第二個**窗口，同上面「R300 未 ready」唔同：R300 已經 `rx start`（開機 1 14.8s、開機 2 10.7s）而且開始 probe，但 micro:bit 一聲都唔應 —— 開機 1 靜咗 **8.1 秒**（probe 到 attempt 17）、開機 2 **10.9 秒**（attempt 30）。期間 RX 收到 `@%`、`A���`、`k":90}`、`},"ck":98}` —— 後兩條係 **R300 自己嗰句嘅碎片**（`"ck":90` 就係 id 157 個 probe），即係對面冇 drive P0 嗰陣 TX 串咗去 RX。**原因未證實**，最合理嘅講法係 micro:bit 嗰邊仲喺度完成 DAPLink 燒錄／重新掛載，未行到 `connect()`。想證實就試：**燒完 micro:bit、等十幾秒、再 reboot R300**，睇第一句 probe 係咪即刻有人應 |
| ✅ 雜訊冇造成假狀態 | 上面啲碎片全部過唔到 `ck`／`v` 檢查所以被丟，而 `live` 只當「**通過 ck** 嘅訊息」係交通，所以冇觸發假 `ONLINE` 或者假 skip。（開機 2 `rx start` 仲報 `flushed 1022 stale bytes`——係 R300 自己 RX task 起之前囤低嘅線噪，`uart_flush_input()` 清走咗，冇污染之後嘅判斷。） |

> 順帶，呢次 capture 也獨立驗證了 `ck` 算法：probe 同 ack 嘅 `ck` 同 `protocol.md` §11 自己算出嚟嘅完全一致（v1 同 v2 兩代都驗過）。

### ⚠️ 未解釋：兩次都要 8–15 秒先連到

兩次開機都要 **17 / 30 次 probe**（即 8.5s / 14.7s）才收到第一個 ack，而不是第一次就通。證據指向「呢段時間 micro:bit 未 drive P0」：

- R300 喺嗰個窗口收到嘅係**浮空線雜訊**，包括 `@%`、`A���`，同埋 `k":90}`——後者係 R300 **自己** probe 嘅碎片（probe `id 139` 帶 `ck:90`），即係 RX 嗡到 TX 隔壁條線。
- Boot 2 一開波就 `flushed 1022 stale bytes`（R300 個 link task 未起之前就已經有過 KB 嘅垃圾囤咗喺 RX）。
- 一旦 micro:bit 開始答，就 17–23ms 一個 round trip，之後永久乾淨。

**成因未確定**（唔影響功能，但學生實測體驗就係「插完要等十幾秒」）。要查嘅方向：micro:bit 係唔係同 R300 共用電源、macOS 有冇同時 mount 住 DAPLink 令 micro:bit 被 reset、以及 micro:bit 自己個 boot 同 R300 個 10–15 秒開機窗口嘅相對時序。

## Troubleshooting

因為而家部署方式改咗做「成個 `.hex` 經 DAPLink 燒」（唔再係 MicroPython 果種靠 live REPL 逐個檔案 copy），**之前 MicroPython 版本成日撞到嘅 `could not enter raw repl` 死症已經唔存在**——唔理板上行緊咩程式，拖新 `.hex` 落 `MICROBIT` 磁碟機一定 work。

如果 flash 完之後喺 R300 嗰邊乜都睇唔到，check 呢幾樣：
1. 開機有冇撳住 Button A？撳住嘅話會留喺 USB，唔會送去 R300
2. `mpremote` 揀咗錯 port（見上面「點睇 Log」嗰個 warning）
3. **R300 開機要 10–15 秒先會開始聽**（見下面「開機時序」）——如果啱啱兩部板一齊 power on，頭十幾秒見唔到嘢／見到亂碼係正常
4. **R300 有冇 provision 咗 WiFi？** 未 provision 嘅話塊板會卡喺 `wifi_configuring` 開緊自己個 config AP，而 `MicrobitLink` 個 RX task 係 gate 喺 `kDeviceStateIdle` 先起——即係話 R300 **完全冇聽緊**條 UART，micro:bit 送幾多都冇反應。Log 見到 `SsidManager: NVS namespace wifi doesn't exist` 就係呢個。行去個 hotspot（`floki-edu-microbit-XXXX`）開 `http://192.168.4.1` 入 WiFi 帳密就得

### 反方向：R300 發 `hello`，但 micro:bit 唔答

症狀：R300 log 只見 `-> {"v":2,"s":"r300","id":N,"t":"r","op":"hello"...}` 重複出現，**永遠冇 `<- ..."op":"hello"`**，而且每 30 秒出一次 `still no hello ack`。兩個成因，症狀一模一樣：

1. **Serial buffer 冇加大**（見上面「一定要加大 serial buffer」）——最常見，而且純軟件問題
2. **實體回程線 `P1 ← GPIO10` 冇駁 / 駁錯**——記住兩邊要**交叉**：`P0 → GPIO21`、`P1 ← GPIO10`，仲要共地

遇到呢個症狀，先排除三樣純軟件嘅原因，最後才查線（三者嘅 log 長得一樣，分唔到）：

1. **`connect()` 裏面兩句 `setRxBufferSize`／`setTxBufferSize` 還在**——唔在嘅話 micro:bit 收到都認唔出
2. **`pxt build` 真嘅重建過**（改完 `protocol.ts` 而冇 rebuild 係常見錯誤；`git status` 唔算數，要睇 `built/binary.hex` 嘅 mtime）
3. **micro:bit 上跑嘅係新 hex**（開機撳住 Button A 會跳過 redirect，條線完全靜）

排除完才去查線：記住兩邊要**交叉**（`P0 → GPIO21`、`P1 ← GPIO10`）而且**共地**。

另一個容易誤會嘅點：**micro:bit 答錯 `id` 嘅 ack 會被 R300 靜默丟掉**（R300 只接受 `id` 同 `op` 都對得上等待中嗰個 `req` 嘅 ack，並且會計一次 stale）。所以就算你見到 R300 收到嘢，只要 `id` 唔對就等於冇答。

### 開機時序：R300 要 ~10–15 秒才開始聽

R300 由 power on 到出 `AimoV1EduMicrobitBoard: microbit link: R300 ready, now accepting messages`，中間隔成 **10–15 秒**（要等 WiFi 連接、OTA check 等步驟做完），而且 `MicrobitLink` 個 RX task 係 gate 喺 `kDeviceStateIdle` 先起。實測：boot 1 喺 `14803ms` 先講 ready，boot 2 喺 `10700ms`。

- **做法**：兩部板一齊開機嘅話，前 10–15 秒冇反應、或者睇到亂碼（實測：`@%`、`A���`、同 R300 自己 probe 嘅碎片 `k":90}`），**唔代表接線有問題**。等 R300 log 出 `R300 ready` 之後再判斷。之後唔應該再出現亂碼——一穩就係永久穩。
- 呢個窗口入面，R300 嗰邊嘅 `MicrobitHello` 會一直在 probe（500ms 一次，冇上限），所以你不需要做任何事，它自己會接上。
- **另一個真正會令 R300 完全聽唔到嘅原因：WiFi 未 provision。** 未 provision 嘅話塊板卡喺 `wifi_configuring` 開緊自己個 config AP，永遠去唔到 `kDeviceStateIdle`，條 UART 也就永遠唔會被聽。Log 見到 `SsidManager: NVS namespace wifi doesn't exist` 就係呢個。行去個 hotspot（`floki-edu-microbit-XXXX`）開 `http://192.168.4.1` 入 WiFi 帳密就得。

其他 log 突發情況：
- `--- Error: device reports readiness to read but returned no data (device disconnected or multiple access on port?)`——呢句喺 **R300 官方自己嘅 `idf_monitor.py`** 都會出，係 ESP32-S3 native USB JTAG/serial 呢個介面本身嘅已知小毛病，唔關我哋個 flow 事，等幾秒 port 通常會自動重連。
- **`Warning: Checksum mismatch between flashed and built applications` 唔關通訊事**——意思係 R300 板上行緊嘅 firmware 同你本機 `build/xiaozhi.elf` 唔係同一個 build。只會令 crash backtrace 解碼唔準，micro:bit link 照常運作。

GND 共用依然係好嘅硬件實踐，值得檢查，但唔係頭號嫌疑。
