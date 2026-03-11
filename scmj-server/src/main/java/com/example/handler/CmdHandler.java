package com.example.handler;

import io.netty.channel.ChannelHandlerContext;
import msg.GameMessage.MainMessage;

/**
 * 指令处理器接口：所有业务逻辑（登录、出牌、操作等）的执行标准
 */
public interface CmdHandler {
    /**
     * 执行具体业务逻辑
     * @param ctx 通信上下文，用于回传消息或获取连接信息
     * @param msg 包含业务载荷的通用信封对象
     */
    void execute(ChannelHandlerContext ctx, MainMessage msg);
}