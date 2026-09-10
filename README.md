# MicroBit ↔ R300 UART Link

用 MakeCode JavaScript（Static TypeScript）喺 BBC micro:bit 上面，每 1 秒經 UART 送一次 **link self-test** 去 R300，一個 round trip 拆成三段，全部喺 R300 個 console 睇得到：

```
① micro:bit → R300    {"MB_cmd":"test","checksum":192}          ← 1s heartbeat
② R300 → micro:bit    {"MB_cmd_ack":"success","checksum":192}
③ micro:bit → R300    {"diag_ack":"success","checksum":192}     ← 證明 reply 真係返到 micro:bit
```

第 ③ 段係關鍵：淨係見到 ② 只代表 R300 **有出** ack，唔代表 micro:bit **真係收到**（例如 micro:bit 條 RX 線斷咗都照樣見得到 ②）。加咗 ③ 之後，兩邊方向都喺同一個 console 一次過驗證晒，唔使同時開住 micro:bit 同 R300 兩邊嘅 port 去對。

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
- **開機撳住 Button A 就會跳過 redirect，留喺 USB**——呢個係我哋自己加落 `main.ts` 嘅 dev 用逃生門，等你唔使成日重燒 firmware 都可以睇 log／再部署

✅ **P0/P1 ↔ GPIO21/GPIO10 呢個配對已經喺 R300 自己嘅開機 log 度得到確認**（本機 capture 咗一句，就係下面呢句）：
```
I (83) MicrobitLink: ready: port=0 tx=10 rx=21 baud=115200
```
即係 R300 呢邊 UART port 0：TX=GPIO10（接落 micro:bit 嘅 P1/RX），RX=GPIO21（收 micro:bit 嘅 P0/TX）。同我哋 `main.ts` 個 comment 一致，唔再係淨係睇 `aimo_v1_edu_microbit_board.cc` 個 comment 推測。

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

每行係一個完整 JSON object 加一個 `\n`，utf-8，唔加密。micro:bit 主動送，R300 收到就回一個 ack。

| # | 送出（micro:bit → R300） | 回覆（R300 → micro:bit） | 觸發者 |
|---|---|---|---|
| 1 | `{"MB_cmd":"test","checksum":192}` | `{"MB_cmd_ack":"success","checksum":192}` | `basic.forever()` 每 1000ms 自動 |
| 2 | `{"MicroBit":"<text>","checksum":<n>}` | `{"MicroBit_ack":"success","checksum":<n>}` | `r300Link.sendMessage(text)` |
| 3 | `{"cmd":"control_motor","rotation":<f>,"forward":<f>,"time":<ms>,"checksum":<n>}` | `{"control_motor_ack":"success","checksum":<n>}` | `r300Link.controlMotor(...)` |

仲有第 ③ 段（micro:bit → R300）：收到 `MB_cmd_ack` 之後，micro:bit 會回一句 `{"diag_ack":"success","checksum":<echo>}`，純粹為咗喺 R300 console 見到「回覆真係返到 micro:bit」。`diag_ack` **唔會**引起無限 ping-pong，因為 R300 冇 handler 收佢，亦特登唔會 ack 佢。

- **Checksum 算法**：`sum(text 逐個字符嘅 char code) % 256`，同 R300 嘅 `Checksum256()`（`aimo_v1_edu_microbit_board.cc`）一致。呢個算法只喺 ASCII 文字下同 Python 版本嘅 `sum(text.encode('utf-8')) % 256` 完全等價。
  - `checksum("test")` = `(116+101+115+116) % 256` = **192**
  - `checksum("Hello World!")` = **61**
- **R300 嗰邊啲 checksum 唔啱或者格式壞咗**，就會 log `not a JSON object` 然後掉棄該行。
- 注意 `control_motor` 嘅 checksum **唔係** checksum 成個 JSON，而係 checksum 佢自己砌嘅 `"%.2f,%.2f,%d"` 字串（例如 `-0.50,0.25,1000`）。所以 `main.ts` 特登寫咗個 `toFixed2()` 去夾硬砌出 byte-for-byte 一樣嘅文字，唔可以直接用 `number.toFixed()`（MakeCode 嘅 `number` 係 `double`，冇 `.toFixed()`）。
- micro:bit 收到 ack 之後淨係**記低時間**（`lastAckTime`），唔會自動回覆 —— 除咗上面講嗰個 `diag_ack`。否則兩塊板會互 ack 到永遠。

### 🔴 一定要加大 serial buffer（MakeCode 預設得 20 bytes）

`connect()` 入面喺 `serial.redirect()` 之後即刻做咗兩句，**唔可以刪**：

```ts
serial.setRxBufferSize(128)
serial.setTxBufferSize(128)
```

**點解**：MakeCode 個 serial RX/TX buffer **預設各得 20 bytes**，但呢條線上面最短嗰句 ack `{"MicroBit_ack":"success","checksum":61}` 已經 **41 bytes**，`control_motor` 更加去到 **78 bytes**。20 bytes 裝唔落，個 ring buffer 喺 `\n` 到達之前就已經捲咗一轉——`serial.readLine()` 攞返嚟嘅係截斷咗嘅尾段，連 `"MicroBit_ack"` 呢個 key 本身都已經俾沖走，所以 `line.indexOf("MicroBit_ack")` 永遠唔會中。

⚠️ **佢個失敗症狀係「完全冧聲」**——唔係亂碼、唔係 checksum 唔啱、`onDataReceived` 睇落好似完全冇 fire 過。喺 R300 個 log 度睇落，同「實體回程線 P1 ← GPIO10 根本冇駁」**一模一樣，分唔到**。呢個亦都正正係點解要有第 ③ 段 `diag_ack`：冇佢就冇任何方法喺 R300 console 分辨「R300 送咗 ack」同「micro:bit 收到 ack」。

揀 128 係因為 R300 嗰邊 `MicrobitLink` 個 RX 行上限同樣係 128 bytes。個參數型別係 `uint8`（上限 255），但加大過 128 冇意義，因為 R300 一樣頂唔住更長嘅行。

## `main.ts` 提供咩 Block？

`main.ts` 入面所有 `//%` annotated 嘅 function 都會喺 MakeCode Blocks 畫面出現（底層 `serial.onDataReceived` 呢啲實作細節就特登冇 annotation，所以唔會喺 Blocks 度噪住你）。

| Block | TypeScript | 用途 |
|---|---|---|
| `connect to R300` | `r300.connect(): R300Link` | 開機做一次：redirect serial 去 P0/P1、加大 buffer、註冊 RX handler |
| `%this send message %text to R300` | `sendMessage(text: string): void` | 送一段自由文字，包成 `MicroBit` JSON |
| `%this test R300 link` | `testLink(): void` | 送一次三段自檢（`MB_cmd`）。主 loop 就係每秒叫呢個 |
| `%this R300 connected` | `isConnected(): boolean` | 最近 3000ms 內有冇收過任何 ack —— 即係 R300 拔咗／熄咗／仲開緊機就會變 `false` |
| `%this move rotation %rotation forward %forward for %time ms` | `controlMotor(rotation, forward, time): boolean` | 郁 R300 底盤。`rotation`／`forward` 係 `-1..1`（最大速度嘅比例），`time` 係 `0..3000` ms |

`controlMotor()` 嘅回傳值要小心理解：佢代表 **R300 有冇接受個指令**，唔係「郁完未」——因為 R300 係**收完即回 ack，之後先至郁**。Timeout 500ms；如果收唔到 ack，或者收到嘅 checksum 對唔上（即係收到上一個 call 嘅殘留 ack）就回 `false`。唔理回傳值直接當 statement 用都安全。

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
MicroBit/
├── .gitignore                    ← repo 層嘅 gitignore，下面「Version Control」有講
├── README.md
├── main.py                       ← ⚠️ 舊 MicroPython 版本，已棄用，淨係留返做歷史記錄
├── Log.txt                       ← 本機 capture 嘅 R300 monitor log（唔 commit）
└── makecode/                     ← pxt workspace
    ├── package.json              ← 釘住 pxt-microbit target 版本
    ├── node_modules/             ← ⚠️ 544 MB，pxt-microbit target 檔案（唔 commit）
    └── hello-microbit/           ← 實際 project，主要改嘢喺呢度
        ├── main.ts               ← ⭐ source of truth，單一檔案，改程式邏輯喺呢個檔案
        ├── main.blocks           ← Blocks 畫面嘅 layout
        ├── pxt.json              ← dependencies (core / radio / microphone)
        ├── tsconfig.json         ← pxt build 用
        ├── Gemfile / _config.yml / Makefile / README.md
        │                         ← 全部係 `pxt init` 生成嘅空樣板，冇改過
        ├── .gitignore            ← pxt 自動生成
        ├── pxt_modules/          ← 安裝落嚟嘅 dependencies（唔 commit）
        └── built/
            └── binary.hex        ← build 出嚟嘅嘢，flash 呢個（唔 commit）
```

## Version Control

Repo：**https://github.com/AxonexCaden/microbit_R300**

Clone 落嚟只有 ~14 個檔案、~400 KB，因為所有生成物都已經 gitignore：

| 唔 commit 嘅嘢 | 大細 | 點解 |
|---|---|---|
| `makecode/node_modules/` | 544 MB | pxt-microbit target 本身，clone 完自己 `pxt target microbit` 裝返 |
| `makecode/hello-microbit/pxt_modules/` | ~1 MB | `pxt install` 自動裝返 |
| `makecode/hello-microbit/built/` | ~3 MB | `pxt build` 生成 |
| `makecode/hello-microbit/.vscode/` | 幾百 B | pxt 生成嘅本機 editor 設定，開一次 folder 就會自動重新生成 |
| `Log.txt` | — | 本機 capture，唔屬於 source |

⚠️ **`makecode/hello-microbit/.gitignore` 係 pxt 自動生成嘅，入面都有行 `built`。** 想連 `built/binary.hex` 都 commit（方便人唔使裝 toolchain 都 flash 到）嘅話，兩邊都要改：root `.gitignore` 要改成 `built/*` + `!built/binary.hex`，而且**同時要刪走 `hello-microbit/.gitignore` 入面嗰行 `built`** —— 因為 nested `.gitignore` 優先過 root，唔刪走嘅話例外唔會生效。

`main.ts` 特登保持單一檔案（將 `r300` namespace／`R300Link` class 同埋主程式邏輯全部放埋一齊），方便直接成個檔案 post 上 makecode.microbit.org 或者傳俾第二個人——`//%` block annotation 唔理個 code 擺喺邊個檔案都照樣生效，所以合併咗都唔影響 Blocks 畫面隱藏底層 `serial.onDataReceived` 呢個設計目的。

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

`pxtarget.json` 嘅 `bundleddirs` 仲有呢幾個現成 package，但要自己喺 `pxt.json` 嘅 `dependencies` 加先會編譯落去（我哋而家個 `pxt.json` 已經帶埋 `radio` 同 `microphone`，係 `pxt init` 自動加嘅，暫時未用到）：

`radio`（micro:bit 之間 2.4GHz 通訊）、`bluetooth`、`servo`、`microphone`（V2 咪高峰）、`datalogger`（用 `MY_DATA.HTM` 嗰個內建 data logging 功能）、`flashlog`、`bitmap`、`fonts`、`color`、`audio-recording`、`audio-samples`、`settings`。

## 點 Clone 同 Build

首次設置（一次性）：
```bash
git clone https://github.com/AxonexCaden/microbit_R300.git
cd microbit_R300

npm install -g pxt        # pxt CLI，全域裝一次就夠

cd makecode
npm install               # 裝返 pxt-microbit target（~544 MB，所以要等一下）
pxt target microbit
```

之後每次改完 `main.ts`，喺 project 資料夾入面 build：
```bash
cd makecode/hello-microbit
pxt build
```
成功嘅話 `built/binary.hex` 會更新。

## 點 Flash

⚠️ **`pxt deploy` 喺呢部 macOS 版本（Sequoia）有已知 bug，唔穩定，唔好用。** 改用最原始、最穩陣嘅方法——直接拖個 build 好嘅 `.hex` 落 `MICROBIT` 磁碟機（DAPLink 經 SWD 燒，同板上行緊咩程式完全無關，一定成功）：

```bash
cp makecode/hello-microbit/built/binary.hex /Volumes/MICROBIT/
```

Copy 完等幾秒，board 會自動 flash 同重新掛載（`cp` 可能會噴一句 `could not copy extended attributes` 嘅 warning，可以忽略，唔影響檔案內容）。

## 點睇 Log

因為 `main.ts` 預設會將 serial redirect 去 P0/P1，睇 log 分兩種情況：

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
呢個模式冇 R300 都可以直接睇到 micro:bit 自己 print 緊乜。

⚠️ **兩部裝置都會顯示做 `/dev/cu.usbmodemXXXX`，port number 拔插之後可能會變** —— 千祈唔好用 `mpremote connect auto`，多過一個裝置嘅時候佢會揀錯。用 `mpremote connect list` 先查實邊個 port 對應邊部裝置（睇 USB descriptor 嗰欄），再用明確 port 連接。

## Troubleshooting

因為而家部署方式改咗做「成個 `.hex` 經 DAPLink 燒」（唔再係 MicroPython 果種靠 live REPL 逐個檔案 copy），**之前 MicroPython 版本成日撞到嘅 `could not enter raw repl` 死症已經唔存在**——唔理板上行緊咩程式，拖新 `.hex` 落 `MICROBIT` 磁碟機一定 work。

如果 flash 完之後喺 R300 嗰邊乜都睇唔到，check 呢幾樣：
1. 開機有冇撳住 Button A？撳住嘅話會留喺 USB，唔會送去 R300
2. `mpremote` 揀咗錯 port（見上面「點睇 Log」嗰個 warning）
3. **R300 開機要 ~13 秒先會開始收 micro:bit 嘅訊息**（見下面）——如果啱啱兩部板一齊 power on，前 13 秒見唔到嘢／見到亂碼係正常
4. **R300 有冇 provision 咗 WiFi？** 未 provision 嘅話塊板會卡喺 `wifi_configuring` 開緊自己個 config AP，而 `MicrobitLink` 個 RX task 係 gate 喺 `kDeviceStateIdle` 先起——即係話 R300 **完全冇聽緊**條 UART，micro:bit 送幾多都冇反應。Log 見到 `SsidManager: NVS namespace wifi doesn't exist` 就係呢個。行去個 hotspot（`floki-edu-microbit-XXXX`）開 `http://192.168.4.1` 入 WiFi 帳密就得

### 反方向：R300 收到，但 micro:bit 好似收唔到回覆

即係 R300 log 見到 `<- {"MB_cmd":"test"...}` 同 `-> {"MB_cmd_ack"...}`，但**永遠冇第 ③ 段 `diag_ack`**。兩個成因，症狀一模一樣：

1. **Serial buffer 冇加大**（見上面「一定要加大 serial buffer」）——最常見，而且純軟件問題
2. **實體回程線 `P1 ← GPIO10` 冇駁 / 駁錯**——記住兩邊要**交叉**：`P0 → GPIO21`、`P1 ← GPIO10`，仲要共地

分辨方法：去程線係好嘅（唔係嘅話 R300 連 `<-` 都唔會見到），所以剩返「buffer」同「回程線」。先 confirm `connect()` 入面兩句 `setRxBufferSize`/`setTxBufferSize` 仲喺度、`pxt build` 真係行過（唔係改咗 `main.ts` 但冇 rebuild），再查線。

### 之前撞過嘅亂碼／冇反應：而家知道係「開機時序」居多，唔一定關 wiring 事

早前懷疑係 GND 冇接好，但翻查 R300 自己個開機 log 之後，證據指向另一個更大機會嘅原因——**開機時序**：

1. R300 由 power on 到出 `AimoV1EduMicrobitBoard: microbit link: R300 ready, now accepting messages`，中間隔咗成 **~13 秒**（要等 WiFi 連接、OTA check 等步驟做完）。呢段時間之前 micro:bit 送嘅嘢，R300 都未開始認真 parse。Log 入面第一個收到嘅訊息正正就係一個空嘅 `not a JSON object: `，之後開始每個都乾淨無誤、每秒一個、連續成 90+ 個 cycle 全部 ack 成功——即係話**一旦 R300 講咗「ready」，通訊就完全穩定**，冇再見過亂碼。呢個模式（頭一兩個唔穩、之後永久乾淨）比較似「R300 未準備好收」，唔似電線接觸不良（如果係接觸不良，成段時間都會斷斷續續，唔會之後突然變到 100% 穩定）。
   - **做法**：兩部板一齊開機嘅話，唔使太緊張頭幾秒嘅亂碼／冇反應，等 R300 log 出現 `R300 ready, now accepting messages` 之後先判斷通訊係咪有問題。
   - 呢個窗口入面 `r300Link.isConnected()` 會回 `false`，係**預期行為**，唔係 bug —— 要等 R300 開完機覆到 ack 先會變 `true`。
2. 個 log 仲見到 `--- Error: device reports readiness to read but returned no data (device disconnected or multiple access on port?)`——呢句同我哋自己用 pyserial 讀 port 撞過嘅錯誤一模一樣，但呢次係喺 **R300 官方自己嘅 `idf_monitor.py`** 入面出現，即係話呢個係 ESP32-S3 native USB JTAG/serial 呢個介面本身嘅已知小毛病，唔關我哋個 flow 事。見到呢個 error 唔使懷疑係自己整壞咗嘢，等幾秒 port 通常會自動重連。

> ℹ️ 上面「90+ 個 cycle」嗰段係喺**舊 protocol**（每秒 `{"MicroBit":"Hello World!","checksum":61}`）之下 capture 嘅。本機嗰份 `Log.txt` 已經 gitignore、唔會跟 repo 走，而 R300 側邊嘅 ack 邏輯冇變過，所以個結論照樣適用。

GND 共用依然係好嘅硬件實踐，值得檢查，但唔再係頭號嫌疑。
