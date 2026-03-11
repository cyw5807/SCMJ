import { _decorator, Component, Node, Prefab, instantiate, Label, Button, director, log, find } from 'cc';
import { NetworkManager } from './NetworkManager';

const { ccclass, property } = _decorator;

@ccclass('LobbyManager')
export class LobbyManager extends Component {
    // --- UI 绑定 ---
    @property(Node) playerListContent: Node = null!; 
    @property(Prefab) playerItemPrefab: Prefab = null!; 
    @property(Button) startBtn: Button = null!;      
    @property(Label) statusLabel: Label = null!;     

    private netManager: NetworkManager | null = null;
    private cachedNetNode: Node | null = null; // 缓存节点引用

    start() {
        log("【大厅】LobbyManager 已启动，正在寻找网络中枢...");
        
        // 1. 寻找并缓存常驻节点引用
        this.cachedNetNode = director.getScene()?.getChildByName("NetworkManager") || find("NetworkManager");
        
        if (this.cachedNetNode) {
            log("【大厅】成功获取并缓存 NetworkManager 节点");
            this.netManager = this.cachedNetNode.getComponent(NetworkManager);
            
            if (this.netManager) {
                log("【大厅】开始注册网络事件监听...");
                // 使用缓存的节点注册监听
                this.cachedNetNode.on("UpdatePlayerList", this.onUpdatePlayerList, this);
                
                // 【修改】监听事件名从 GameStartData 改为 GameStateSync
                // 原因：NetworkManager 在收到 1005 时派发的是这个新事件名
                this.cachedNetNode.on("GameStateSync", this.onGameStart, this); 

                // 主动同步一次现有的缓存名单
                const list = this.netManager.getLastPlayerList();
                if (list && list.length > 0) {
                    this.onUpdatePlayerList(list);
                }
            }
        } else {
            log("【错误】无法找到 NetworkManager 常驻节点，请检查场景层级结构！");
        }
    }

    /** 处理玩家列表刷新 */
    private onUpdatePlayerList(players: any[]) {
        // 安全检查：如果组件已被销毁则停止操作
        if (!this.node || !this.node.isValid) return;

        log("【大厅】收到名单更新，人数:", players.length);
        this.playerListContent.removeAllChildren();

        let isMeHost = false;
        const myName = this.netManager?.getNickname();
        
        players.forEach((player) => {
            const item = instantiate(this.playerItemPrefab);
            const label = item.getComponent(Label) || item.getComponentInChildren(Label);
            if (label) {
                label.string = (player.isHost ? "★ " : "") + player.nickname;
            }
            this.playerListContent.addChild(item);

            // 权限判定：如果是房主且昵称匹配
            if (player.isHost && player.nickname === myName) {
                isMeHost = true;
            }
        });

        // 更新按钮状态
        if (this.startBtn) {
            this.startBtn.node.active = isMeHost;
            this.startBtn.interactable = players.length >= 2 && players.length <= 4; // 只有2-4人才能开始
        }

        if (this.statusLabel) {
            this.statusLabel.string = `房间状态: 正在等待 (${players.length}/4)`;
        }
    }

    public onStartBtnClick() {
        if (this.netManager) {
            log("【大厅】房主点击开始游戏，发送 1004 指令...");
            this.netManager.sendStartGameRequest();
        }
    }

    private onGameStart() {
        log("【大厅】收到桌面状态同步 (1005)，准备载入麻将场景...");
        // 收到 1005 意味着游戏已经开始，跳转到游戏场景
        director.loadScene("GameScene");
    }

    /**
     * 安全销毁逻辑
     */
    onDestroy() {
        // 1. 使用缓存的节点引用取消监听
        if (this.cachedNetNode && this.cachedNetNode.isValid) {
            log("【大厅】正在注销网络监听并清理资源...");
            this.cachedNetNode.off("UpdatePlayerList", this.onUpdatePlayerList, this);
            
            // 【修改】注销时事件名也需要同步修改
            this.cachedNetNode.off("GameStateSync", this.onGameStart, this);
        }

        // 2. 访问子节点前进行有效性检查
        if (this.node && this.node.isValid) {
            const playerLayout = this.node.getChildByName("Layout_Players"); 
            if (playerLayout) {
                playerLayout.removeAllChildren();
            }
        }
        
        // 清理引用
        this.cachedNetNode = null;
        this.netManager = null;
    }
}