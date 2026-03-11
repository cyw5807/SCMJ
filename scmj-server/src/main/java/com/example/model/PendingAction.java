package com.example.model;

import java.util.ArrayList;
import java.util.List;

import msg.GameMessage.CardInfo;

/**
 * 挂起的拦截动作记录
 */
public class PendingAction {
    public int seatIndex = 0;       // 发起动作的玩家座位号
    public int actionCode = 0;      // 对应的 ActionType 数字 (4:胡, 3:杠, 2:碰, 5:吃, 6:过)
    public int priority = 0;        // 动作优先级 (数字越大优先级越高)
    
    // 胡牌附加数据
    public int totalFan = 0;
    public List<String> fanNames = new ArrayList<>();

    // 存放吃牌参数
    public List<CardInfo> extraCards = new ArrayList<>();
    
    /**
     * 极其严格的安全构造函数
     */
    public PendingAction(int seat, int action, int fan, List<String> names, List<CardInfo> cards) {
        // 安全兜底：所有数值不得小于 0，集合绝对不能为 null
        this.seatIndex = Math.max(0, seat);
        this.actionCode = Math.max(0, action);
        this.totalFan = Math.max(0, fan);
        this.fanNames = names == null ? new ArrayList<>() : names;
        this.extraCards = cards == null ? new ArrayList<>() : cards; // 安全兜底
        
        // 核心优先级体系：胡(4) > 碰/杠(3) > 吃(2) > 过(0)
        if (this.actionCode == 4) {
            this.priority = 4;
        } else if (this.actionCode == 2 || this.actionCode == 3) {
            this.priority = 3;
        } else if (this.actionCode == 5) {
            this.priority = 2;
        } else {
            this.priority = 0; // PASS 或未定义动作一律最低
        }
    }
}