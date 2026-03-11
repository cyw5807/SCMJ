package com.example;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.util.List;

import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.ChannelFuture;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.ChannelHandler.Sharable;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import io.netty.handler.codec.MessageToMessageDecoder;
import io.netty.handler.codec.MessageToMessageEncoder;
import io.netty.handler.codec.http.HttpObjectAggregator;
import io.netty.handler.codec.http.HttpServerCodec;
import io.netty.handler.codec.http.websocketx.BinaryWebSocketFrame;
import io.netty.handler.codec.http.websocketx.WebSocketServerProtocolHandler;
import io.netty.handler.codec.protobuf.ProtobufDecoder;
import io.netty.handler.codec.protobuf.ProtobufEncoder;
import io.netty.handler.stream.ChunkedWriteHandler;
import io.netty.handler.logging.LogLevel;
import io.netty.handler.logging.LoggingHandler;
import msg.GameMessage.MainMessage;

public class GameServer {
    private final int port;
    // 显式声明绑定地址为 0.0.0.0（全网可访问，适配内网穿透）
    private static final String BIND_ADDRESS = "0.0.0.0";

    public GameServer(int port) {
        this.port = port;
    }

    public void start() throws Exception {
        // 1. Boss线程组：负责接收客户端连接（指定线程数为1，减少资源占用）
        EventLoopGroup bossGroup = new NioEventLoopGroup(1);
        // 2. Worker线程组：负责处理具体的读写业务（默认核心数*2）
        EventLoopGroup workerGroup = new NioEventLoopGroup();

        try {
            ServerBootstrap b = new ServerBootstrap();
            b.group(bossGroup, workerGroup)
             .channel(NioServerSocketChannel.class)
             // 绑定到 0.0.0.0 地址（关键：让内网穿透能访问）
             .localAddress(new InetSocketAddress(BIND_ADDRESS, port))
             // 【可选】日志处理器：方便调试内网穿透后的连接问题
            //  .handler(new LoggingHandler(LogLevel.INFO))
             .childHandler(new ChannelInitializer<SocketChannel>() {
                @Override
                protected void initChannel(SocketChannel ch) {
                    var pipeline = ch.pipeline();

                    pipeline.addLast(new HttpServerCodec());
                    pipeline.addLast(new ChunkedWriteHandler());
                    pipeline.addLast(new HttpObjectAggregator(65536));

                    // 【修改】将 checkStartsWith 改为 true。
                    // 原因：部分浏览器或代理在握手时可能会附加查询参数，确保 WebSocket 握手更稳健。
                    pipeline.addLast(new WebSocketServerProtocolHandler("/ws", null, true, 65536, false, true));

                    // ================== 出站处理器（从下往上） ==================
                    // 【修改】调整次序：先将 Protobuf 对象转为 ByteBuf，再包装成 WebSocket 帧。
                    // 原因：Netty 出站是从后往前执行的。逻辑上应先由 ProtobufEncoder 处理 MainMessage，
                    // 再由封装类转为 BinaryFrame 发出。
                    pipeline.addLast(new ByteBufToBinaryWebSocketFrameEncoder());
                    pipeline.addLast(new ProtobufEncoder());

                    // ================== 入站处理器（从上到下） ==================
                    pipeline.addLast(new BinaryWebSocketFrameToByteBufDecoder());
                    pipeline.addLast(new ProtobufDecoder(MainMessage.getDefaultInstance()));

                    // ================== 业务逻辑处理器 ==================
                    // 【建议】此处应替换为你新创建的麻将逻辑处理器，例如 MahjongServerHandler
                    pipeline.addLast(new GameServerHandler()); 
                }
            });

            System.out.println(">>> 麻将游戏服务器在地址 " + BIND_ADDRESS + ":" + port + " 启动成功...");
            // 绑定地址并同步等待启动
            ChannelFuture f = b.bind().sync();
            // 等待服务端端口关闭（阻塞）
            f.channel().closeFuture().sync();
        } catch (Exception e) {
            // 【新增】捕获启动异常，方便排查内网穿透连接问题
            System.err.println("服务器启动失败：" + e.getMessage());
            e.printStackTrace();
        } finally {
            // 优雅关闭线程组
            bossGroup.shutdownGracefully().sync();
            workerGroup.shutdownGracefully().sync();
            System.out.println(">>> 麻将游戏服务器已关闭");
        }
    }

    public static void main(String[] args) throws Exception {
        // 启动端口 8888（和 FRP 穿透的本地端口一致）
        new GameServer(8888).start();
    }

    // WebSocket 二进制帧转 ByteBuf（入站）
    @Sharable
    private static class BinaryWebSocketFrameToByteBufDecoder extends MessageToMessageDecoder<BinaryWebSocketFrame> {
        @Override
        protected void decode(ChannelHandlerContext ctx, BinaryWebSocketFrame frame, List<Object> out) {
            try {
                // 保留引用，避免 Netty 自动释放缓冲区
                out.add(frame.content().retain());
            } catch (Exception e) {
                ctx.close(); // 解码失败时关闭连接，避免资源泄漏
                System.err.println("WebSocket 帧解码失败：" + e.getMessage());
            }
        }
    }

    // ByteBuf 转 WebSocket 二进制帧（出站）
    @Sharable
    private static class ByteBufToBinaryWebSocketFrameEncoder extends MessageToMessageEncoder<io.netty.buffer.ByteBuf> {
        @Override
        protected void encode(ChannelHandlerContext ctx, io.netty.buffer.ByteBuf msg, List<Object> out) {
            try {
                // 将 Protobuf 编码后的 ByteBuf 包装为 WebSocket 二进制帧
                out.add(new BinaryWebSocketFrame(msg.retain()));
            } catch (Exception e) {
                System.err.println("WebSocket 帧编码失败：" + e.getMessage());
            }
        }
    }
}