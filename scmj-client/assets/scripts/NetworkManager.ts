import { _decorator, Component, log, director, EditBox, find, Node } from 'cc';
import { MainMessage, encodeMainMessage, decodeMainMessage, ActionType, PlayerActionRequest, CardInfo } from './proto/GameMessage';

const { ccclass, property } = _decorator;

@ccclass('NetworkManager')
export class NetworkManager extends Component {
    @property(EditBox) public nicknameEdit: EditBox = null!;

    private socket: WebSocket | null = null;
    private myNickname: string = ""; 
    private lastPlayerList: any[] = [];
    private lastGameData: MainMessage | null = null; // 缓存最新的游戏数据
    private mySeatIndex: number = -1;

    onLoad() {
        // 确保 NetworkManager 跨场景存在
        director.addPersistRootNode(this.node); 
    }

    start() { 
        this.connect(); 
    }

    public getNickname(): string { return this.myNickname; }
    public getMySeatIndex(): number { return this.mySeatIndex; }

    connect() {
        // 请根据你的后端地址修改
        this.socket = new WebSocket("ws://117.50.163.196:7892/ws");
        // this.socket = new WebSocket("ws://localhost:8888/ws");
        this.socket.binaryType = "arraybuffer"; 

        this.socket.onopen = () => log("【网络】连接服务器成功！");
        this.socket.onerror = (err) => log("【网络】连接错误:", err);
        this.socket.onclose = () => log("【网络】连接已关闭");

        this.socket.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
                const buffer = new Uint8Array(event.data);
                try {
                    const recvMsg = decodeMainMessage(buffer);
                    this.handleMessage(recvMsg);
                } catch (e) { 
                    log("【网络】解析二进制消息失败:", e); 
                }
            }
        };
    }

    public getLastPlayerList() {
        return this.lastPlayerList;
    }

    /**
     * 通用发送接口
     */
    public send(data: any) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            try {
                const buffer = encodeMainMessage(data);
                this.socket.send(buffer);
            } catch (e) {
                log("【网络】编码发送失败:", e);
            }
        } else {
            log("【网络】发送失败：WebSocket 未连接或已断开");
        }
    }

    private handleMessage(msg: MainMessage) {
        log("【网络】收到 Code:", msg.code);

        // 基础防御逻辑：确保节点有效
        if (!this.node || !this.node.isValid) return;

        switch (msg.code) {
            case 1002: // 登录响应
                if (msg.loginResponse?.success) {
                    log("【系统】登录成功，准备跳转大厅...");
                    director.loadScene("LobbyScene");
                }
                break;

            case 1003: // 玩家列表广播
                this.lastPlayerList = msg.playerList?.players || [];
                
                // 锁定自己的座位号
                const myName = this.myNickname.trim();
                const me = this.lastPlayerList.find(p => p.nickname === myName);
                if (me) {
                    this.mySeatIndex = (me.seatIndex !== undefined && me.seatIndex !== null) 
                        ? me.seatIndex 
                        : (me.seat_index !== undefined ? me.seat_index : 0);
                    log(`【网络】身份锁定成功！我的座位号是: ${this.mySeatIndex}`);
                }
                
                this.node.emit("UpdatePlayerList", this.lastPlayerList);
                break;

            case 1005: // 【修改】游戏/桌面状态同步
                // 原因：扑克的 gameStartData 已被替换为麻将的 gameState
                const actionSeat = msg.gameState?.currentActionSeat === undefined ? 0 : msg.gameState.currentActionSeat;
                log(`【网络】收到桌面状态同步，当前行动者座位号: ${actionSeat}`);
                this.lastGameData = msg;
                
                // 如果不在游戏场景，先跳转再发射事件
                if (director.getScene().name !== "GameScene") {
                    director.loadScene("GameScene", () => {
                        // 【修改】派发事件名改为 GameStateSync
                        this.node.emit("GameStateSync", msg);
                    });
                } else {
                    this.node.emit("GameStateSync", msg);
                }
                break;

            case 1007: // 终局结算报告
                log("【网络】收到终局总榜单数据...");
                director.emit("FinalResult", msg);
                break;
                
            case 1008: // 单局结算小结
                // 原因：匹配新协议 RoundSummary，替换旧的牌型展示逻辑
                log("【网络】收到单局结算小结广播");
                director.emit("RoundSummary", msg); 
                break;

            default:
                log("【警告】收到未定义的协议 Code:", msg.code);
                break;
        }
    }

    // --- 业务快捷方法 ---

    /** 主动发送登录 (1001) */
    public sendLogin(nickname: string) {
        this.myNickname = nickname;
        this.send({
            code: 1001,
            loginRequest: { nickname: nickname }
        });
    }

    /** 发送开始游戏请求 (1004) */
    public sendStartGameRequest() {
        this.send({ code: 1004 });
    }

    /**
     * 向服务器发送玩家动作 (1006)
     * @param action 动作类型 (ActionType)
     * @param extraData 附加数据 (可能是打出的牌，也可能是胡牌的番数)
     */
    public sendPlayerAction(action: ActionType, extraData?: any) {
        // 1. 初始化 actionReq 基础数据，严格防范 action 为 undefined
        let reqData: any = { 
            action: action === undefined ? 0 : action 
        };

        // 2. 动态塞入附加数据
        if (extraData) {
            // 场景 A：带有麻将牌信息（用于出牌 DISCARD）
            if (extraData.type !== undefined && extraData.value !== undefined) {
                reqData.card = {
                    type: extraData.type === undefined ? 0 : extraData.type,
                    value: extraData.value === undefined ? 0 : extraData.value
                };
            }
            
            // 场景 B：带有番数信息（用于胡牌 HU）
            if (extraData.totalFan !== undefined) {
                // 严格防范 undefined，保障数值安全转换
                reqData.totalFan = extraData.totalFan === undefined ? 0 : extraData.totalFan;
                reqData.fanNames = extraData.fanNames || [];
            }
        }

        // 3. 直接调用已封装好的 send 方法
        this.send({
            code: 1006,
            actionReq: reqData
        });

        log(`【网络】已发送动作包 (1006), Action: ${reqData.action}, 携带附加数据已发送。`);
    }

    /**
     * 【新增】发送准备下一局请求 (1009)
     */
    public sendReadyNextMatch() {
        this.send({
            code: 1009,
            readyReq: { isReady: true }
        });
    }

    /** * 获取最后一次收到的游戏数据
     * 用于 GameManager 在 start 中主动拉取
     */
    public getLastGameData() {
        return this.lastGameData;
    }

    public onLoginBtnClick() {
        if (!this.nicknameEdit) return;
        this.sendLogin(this.nicknameEdit.string);
    }
}