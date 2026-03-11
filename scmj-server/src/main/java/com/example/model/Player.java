package com.example.model;

import io.netty.channel.Channel;
import java.util.ArrayList;
import java.util.List;
import msg.GameMessage.CardInfo;
import msg.GameMessage.CardSet; // 【修改】导入新的牌组结构

/**
 * 玩家实体类：代表博弈关系中的独立主体
 */
public class Player {
    // --- 基础身份属性 ---
    private String nickname;       // 玩家昵称
    private String cid;            // 唯一连接 ID (由服务器分配)
    private int seatIndex = -1;    // 座位号 (0-3)
    private boolean isHost = false; // 是否为房主

    // --- 资产与战绩属性 ---
    private int score = 0;         // 累积得分
    private List<CardInfo> handCards = new ArrayList<>();   // 个人持有的私有手牌
    private List<CardInfo> discardedCards = new ArrayList<>(); // 个人打出的牌历史
    
    // 将 List<CardInfo> 改为 List<CardSet>。
    // 原因：麻将的“成牌”不仅是单张牌的集合，而是由“碰、杠、吃”组成的牌组，需要记录动作类型。
    private List<CardSet> formedSets = new ArrayList<>(); 

    // 新增回合行动标识。
    // 原因：为了实现“同一时刻只有一个玩家进行回合”，后端需要标记当前谁拥有操作权。
    private boolean isMyTurn = false;

    // 新增状态标记
    private boolean alreadyHu = false;

    private int roundScoreDelta = 0;

    // --- 网络通信属性 ---
    private Channel channel;       // 通信通道

    public Player(String cid, String nickname, Channel channel) {
        this.cid = cid;
        this.nickname = nickname;
        this.channel = channel;
    }

    // --- 核心业务逻辑方法 ---

    public void addScore(int delta) {
        this.score += delta;
    }

    /**
     * 【轮次重置】重置当前轮次的卡牌
     */
    public void clearMatchData() {
        this.handCards.clear();
        this.formedSets.clear(); // 清理新定义的牌组列表
        this.isMyTurn = false;   // 重置回合状态
    }

    /**
     * 【整局重置】回归初始状态
     */
    public void resetSession() {
        this.score = 0;
        this.clearMatchData();
    }

    // --- 属性访问器 (Getters & Setters) ---

    public String getNickname() { return nickname; }
    public void setNickname(String nickname) { this.nickname = nickname; }

    public String getCid() { return cid; }
    public void setCid(String cid) { this.cid = cid; }

    public int getScore() { return score; }
    public void setScore(int score) { this.score = score; }

    public int getSeatIndex() { return seatIndex; }
    public void setSeatIndex(int seatIndex) { this.seatIndex = seatIndex; }

    public boolean isHost() { return isHost; }
    public void setHost(boolean host) { isHost = host; }

    public List<CardInfo> getHandCards() { return handCards; }
    public void setHandCards(List<CardInfo> handCards) { this.handCards = handCards; }

    public List<CardInfo> getDiscardedCards() { return discardedCards; }

    public void setDiscardedCards(List<CardInfo> discardedCards) { this.discardedCards = discardedCards; }

    // 【修改】配套的 Getter/Setter 调整
    public List<CardSet> getFormedSets() { return formedSets; }
    public void setFormedSets(List<CardSet> sets) { this.formedSets = sets; }

    // 【修改】新增回合标识的访问器
    public boolean isMyTurn() { return isMyTurn; }
    public void setMyTurn(boolean myTurn) { isMyTurn = myTurn; }

    public Channel getChannel() { return channel; }
    public void setChannel(Channel channel) { this.channel = channel; }

    public boolean isAlreadyHu() { return alreadyHu; }
    public void setAlreadyHu(boolean alreadyHu) { this.alreadyHu = alreadyHu; }

    public int getRoundScoreDelta() { return roundScoreDelta; }
    public void resetRoundScoreDelta() { this.roundScoreDelta = 0; }

    /**
     * 【核心封装】统一的分数操作入口
     * 保证总分和单局变动分绝对同步
     */
    public void modifyScore(int delta) {
        this.score += delta;
        this.roundScoreDelta += delta;
    }
    @Override
    public String toString() {
        return "Player{" +
                "nickname='" + nickname + '\'' +
                ", seatIndex=" + seatIndex +
                ", score=" + score +
                ", isHost=" + isHost +
                ", isMyTurn=" + isMyTurn + // 【修改】日志打印增加回合信息
                ", cards=" + (handCards.size()) +
                '}';
    }
}