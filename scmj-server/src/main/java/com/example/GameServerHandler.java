package com.example;

import com.example.handler.MsgDispatcher;

import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.channel.group.ChannelGroup;
import io.netty.channel.group.DefaultChannelGroup;
import io.netty.util.concurrent.GlobalEventExecutor;
import msg.GameMessage.MainMessage;

/**
 * 核心逻辑处理器：负责连接生命周期管理与消息分发
 */
public class GameServerHandler extends SimpleChannelInboundHandler<MainMessage> {

    // 管理所有在线连接的 Channel
    public static ChannelGroup onlinePlayers = new DefaultChannelGroup(GlobalEventExecutor.INSTANCE);

    @Override
    public void channelActive(ChannelHandlerContext ctx) throws Exception {
        onlinePlayers.add(ctx.channel());
        System.out.println("【系统】新连接建立，当前在线: " + onlinePlayers.size());
        super.channelActive(ctx);
    }

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, MainMessage msg) throws Exception {
        try {
            // 将解析后的 Protobuf 消息分发给业务层
            MsgDispatcher.dispatch(ctx, msg);
        } catch (Exception e) {
            System.err.println("【错误】业务分发异常: " + e.getMessage());
            e.printStackTrace();
        }
    }

    @Override
    public void channelInactive(ChannelHandlerContext ctx) throws Exception {
        // 【修改】将移除逻辑从 handlerRemoved 提前到 channelInactive。
        // 原因：在麻将回合制中，网络掉线（Inactive）通常先于 Handler 移除发生。
        // 提前通知 MsgDispatcher 可以更快触发“掉线托管”或“自动跳过回合”逻辑。
        String channelId = ctx.channel().id().asLongText();
        MsgDispatcher.removePlayer(channelId);
        
        onlinePlayers.remove(ctx.channel());
        System.out.println("【系统】连接断开，剩余在线: " + onlinePlayers.size());
        super.channelInactive(ctx);
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        // 【修改】细化异常处理日志，过滤掉常见的 WebSocket 握手异常。
        // 原因：防止 DecoderException 刷屏导致无法查看真正的逻辑错误（如空指针）。
        if (!(cause instanceof io.netty.handler.codec.DecoderException)) {
            System.err.println("【警告】发现未知异常: " + cause.getMessage());
            cause.printStackTrace();
            ctx.close();
        }
    }

    @Override
    public void handlerRemoved(ChannelHandlerContext ctx) throws Exception {
        // 保持原样，作为最后一道清理防线
        super.handlerRemoved(ctx);
        onlinePlayers.remove(ctx.channel());
    }
}