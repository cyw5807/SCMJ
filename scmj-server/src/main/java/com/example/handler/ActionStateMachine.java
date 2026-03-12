package com.example.handler;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import com.example.model.PendingAction;
import msg.GameMessage.CardInfo;

/**
 * 多人动作拦截状态机 (支持一炮多响)
 */
public class ActionStateMachine {
    // 动作缓冲区：记录当前回合收到的所有有效拦截动作 (Key: 座位号)
    private Map<Integer, PendingAction> actionBuffer = new HashMap<>();
    
    // 状态机是否正在等待拦截
    private boolean isIntercepting = false; 
    
    // 核心开关：是否允许“吃”逻辑 (可随时改为 false 关闭)
    private boolean isChiEnabled = true;

    // 触发结算所需的响应总数 (通常是总人数 - 1，即除了出牌者之外的所有人)
    private int requiredResponses = 0;

    // 记录出牌人的座位和总人数，用于计算冲突时的座位距离
    private int currentDiscarderSeat = 0;
    private int totalRoomPlayers = 4;

    /**
     * 开启拦截收集窗口
     * @param exactWaitCount 外部计算好的、精确的未胡存活人数
     * @param discarderSeat 出牌者的座位
     * @param roomSize 物理房间总人数 (用于计算座位距离)
     */
    public void startInterceptWindow(int exactWaitCount, int discarderSeat, int roomSize) {
        this.actionBuffer.clear();
        this.isIntercepting = true;
        
        // 1. 物理房间人数：专门留给 resolveMultipleActions 算截胡距离用的
        this.totalRoomPlayers = Math.max(2, roomSize); 
        this.currentDiscarderSeat = Math.max(0, discarderSeat);
        
        // 2. 动态响应人数：直接信任 GameController 传来的精确数值，坚决不做多余的篡改！
        this.requiredResponses = exactWaitCount; 
        
        System.out.println("【状态机】玩家 " + this.currentDiscarderSeat + " 出牌，开启拦截窗口，等待 " + this.requiredResponses + " 名玩家响应...");
        
        // 极端防呆：如果刚好算出等待人数为 0（虽然外层有 if 判断，但底层也加个保险）
        if (this.requiredResponses <= 0) {
            this.isIntercepting = false;
        }
    }

    /**
     * 接收玩家发来的动作指令
     */
    public void receiveAction(int seatIndex, int actionCode, int totalFan, List<String> fanNames, List<CardInfo> extraCards) {
        // 1. 如果窗口已关闭，丢弃该消息
        if (!this.isIntercepting) return;

        // 2. 数值安全清洗
        int safeActionCode = Math.max(0, actionCode);
        
        // 3. 动态“吃”逻辑降级：如果未开启吃功能，把吃(5)强制降级为过(6)
        if (!this.isChiEnabled && safeActionCode == 5) {
            safeActionCode = 6; 
        }

        // 4. 生成安全的动作对象并存入缓冲区
        PendingAction action = new PendingAction(seatIndex, safeActionCode, totalFan, fanNames, extraCards);
        this.actionBuffer.put(action.seatIndex, action);
        
        System.out.println("【状态机】收到玩家 " + action.seatIndex + " 的动作: " + action.actionCode + " | 当前已收集: " + this.actionBuffer.size() + "/" + this.requiredResponses);

        // 5. 检查是否所有人（未胡牌的存活玩家）都已经做出了选择
        if (this.actionBuffer.size() >= this.requiredResponses) {
            System.out.println("【状态机】收集完毕！关闭拦截窗口，等待主控制流裁决...");
            // 核心修改：这里只负责关闭状态机护盾，具体的决断交由 GameController 调用 resolveMultipleActions 执行
            this.isIntercepting = false; 
        }
    }

    /**
     * 关闭窗口，清理数据
     */
    public void resetMachine() {
        this.isIntercepting = false;
        this.actionBuffer.clear();
    }

    /**
     * 内部结算：支持一炮多响的终极决断器
     * @return 返回胜出的动作列表（如果所有人都点了“过”，则返回空列表）
     */
    public List<PendingAction> resolveMultipleActions() {
        // 双重保险：确保窗口确实已关闭
        this.isIntercepting = false; 
        
        List<PendingAction> huActions = new ArrayList<>();
        PendingAction maxOtherAction = null;
        int maxPriority = 0;
        int minDistance = 999; 

        // 1. 遍历缓冲区里的所有动作
        for (PendingAction action : this.actionBuffer.values()) {
            
            // 如果玩家点了“过”(priority <= 0)，直接跳过不参与竞争
            if (action.priority <= 0) {
                continue;
            }

            // 如果动作是胡牌 (假设胡牌枚举值为 4)，直接加入一炮多响大军
            if (action.actionCode == 4) { 
                huActions.add(action);
            } 
            // 如果不是胡牌，则进入普通的优先级与距离比较 (碰 / 杠)
            else {
                int distance = (action.seatIndex - this.currentDiscarderSeat + this.totalRoomPlayers) % this.totalRoomPlayers;
                int safeDistance = Math.max(1, distance);

                if (action.priority > maxPriority) {
                    maxPriority = action.priority;
                    maxOtherAction = action;
                    minDistance = safeDistance;
                } 
                else if (action.priority == maxPriority && maxPriority > 0) {
                    if (safeDistance < minDistance) {
                        maxOtherAction = action;
                        minDistance = safeDistance;
                    }
                }
            }
        }

        // 2. 【核心优先级降维打击】
        // 只要有人胡（无论几个），直接返回所有胡的动作！其他碰杠全部作废！
        if (!huActions.isEmpty()) {
            System.out.println("【状态机】筛选完成！触发胡牌拦截，胡牌人数: " + huActions.size());
            return huActions;
        }

        // 3. 如果没人胡，才返回那个唯一的碰或杠
        List<PendingAction> result = new ArrayList<>();
        if (maxOtherAction != null) {
            System.out.println("【状态机】筛选完成！胜出者: 座位 " + maxOtherAction.seatIndex + "，动作: " + maxOtherAction.actionCode);
            result.add(maxOtherAction);
        } else {
            System.out.println("【状态机】筛选完成！所有人都选择了“过”或没有有效动作。");
        }

        return result;
    }

    // --- 状态访问器 ---
    public boolean isIntercepting() { return isIntercepting; }
}