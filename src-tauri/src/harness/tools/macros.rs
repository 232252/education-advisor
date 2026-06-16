//! `tools_eaa!` 宏 — 把 30 个 eaa_tools 函数包成 30 个 struct + impl Tool
//!
//! 设计动机:
//! - eaa_tools.rs 里 ~30 个 `pub(crate) fn tool_xxx(args, caps) -> Result<Value>`
//! - 每个都只差在 name/desc/schema/caps/is_write 和 handler body
//! - 用宏一次性生成 struct + impl, 避免 30 份样板代码
//!
//! 使用方式 (handler 写法):
//! ```ignore
//! tools_eaa! {
//!     pub AddEvent => {
//!         name: "add_event",
//!         desc: "为某学生添加一次分数事件",
//!         schema: json!({...}),
//!         caps: &["write:events"],
//!         is_write: true,
//!         // handler 是 async 块, body 中可直接用 args (Value) 和 ctx (&ToolContext)
//!         handler: async |args, ctx| {
//!             let student = args["student"].as_str().unwrap_or("");
//!             Ok(json!({"ok": true}))
//!         }
//!     }
//! }
//! ```
//!
//! ## 设计权衡
//! 原计划用 `|args, ctx| async move {...}` 闭包, 但遇到 macro 展开后 .await 上下文问题。
//! 现采用 `async |args, ctx| { ... }` 语法糖: macro 把它展开为
//! ```ignore
//! async fn call(&self, __args, __ctx) -> ... {
//!     let __handler = async move |__args, __ctx| { ... };
//!     // 不行, async 闭包不能这样调用
//! }
//! ```
//!
//! ## 实际展开方式 (v3):
//! handler 必须是一个**完整表达式**, 返回 `Pin<Box<dyn Future + Send>>`.
//! 用户写法: `handler: Box::pin(async move { ... })`
//! macro 展开为:
//! ```ignore
//! async fn call(&self, __args, __ctx) -> ... {
//!     let __future: Pin<Box<dyn Future<Output=Result<Value, ToolError>> + Send>> =
//!         Box::pin(async move { /* 用户代码 */ });
//!     __future.await
//! }
//! ```
//!
//! **handler 必须是 expr, body 里直接用 args (Value) 和 ctx (&ToolContext)**.

#[macro_export]
macro_rules! tools_eaa {
    () => {};

    (
        $(#[$attr:meta])*
        $vis:vis $struct_name:ident => {
            name: $tool_name:expr,
            desc: $desc:expr,
            schema: $schema:expr,
            caps: $caps:expr,
            is_write: $is_write:expr,
            handler: async |$args:ident, $ctx:ident| $body:block $(,)?
        }
        $($rest:tt)*
    ) => {
        $(#[$attr])*
        $vis struct $struct_name;

        #[async_trait::async_trait]
        impl $crate::harness::tools::Tool for $struct_name {
            fn name(&self) -> &'static str { $tool_name }
            fn description(&self) -> &'static str { $desc }
            fn input_schema(&self) -> ::serde_json::Value { $schema }
            fn capabilities(&self) -> &'static [&'static str] { $caps }
            fn is_write(&self) -> bool { $is_write }

            async fn call(
                &self,
                __args: ::serde_json::Value,
                __ctx: &$crate::harness::tools::ToolContext,
            ) -> ::std::result::Result<::serde_json::Value, $crate::harness::tools::ToolError> {
                // 用 move 把 __args 和 __ctx 转入 async block, 闭包捕获
                async move {
                    // 提供 args 和 ctx 别名, 用户 body 用 $args 和 $ctx
                    let $args = __args;
                    let $ctx = __ctx;
                    $body
                }.await
            }
        }

        $crate::tools_eaa! {
            $($rest)*
        }
    };
}