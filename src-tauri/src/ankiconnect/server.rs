// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! The HTTP listener on 127.0.0.1. Every request runs on a blocking thread,
//! so collection work and permission prompts never hold up the runtime or
//! the interface. At most [`MAX_IN_FLIGHT`] requests are read and run at
//! once; the rest wait their turn before their bodies are read, so large
//! bodies and downloads cannot pile up in memory.

use std::net::Ipv4Addr;
use std::sync::Arc;

use axum::extract::Request;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::response::Response;
use axum::Router;
use tokio::sync::oneshot;
use tokio::sync::Semaphore;

use super::protocol;
use super::protocol::Host;
use super::protocol::HttpRequest;

/// Request bodies may carry base64 media.
const MAX_BODY: usize = 256 * 1024 * 1024;
pub const MAX_IN_FLIGHT: usize = 8;

struct Server {
    host: Arc<dyn Host>,
    slots: Semaphore,
}

pub struct Running {
    pub port: u16,
    shutdown: Option<oneshot::Sender<()>>,
}

impl Drop for Running {
    fn drop(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
    }
}

#[derive(Debug)]
pub struct BindError {
    pub in_use: bool,
    pub message: String,
}

/// Binds 127.0.0.1:`port` (0 picks a free port) and serves until the returned
/// handle is dropped.
pub fn start(host: Arc<dyn Host>, port: u16) -> Result<Running, BindError> {
    let fail = |err: std::io::Error| BindError { in_use: err.kind() == std::io::ErrorKind::AddrInUse, message: err.to_string() };
    let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, port)).map_err(fail)?;
    listener.set_nonblocking(true).map_err(fail)?;
    let port = listener.local_addr().map_err(fail)?.port();
    let (shutdown, stopped) = oneshot::channel::<()>();
    let server = Arc::new(Server { host, slots: Semaphore::new(MAX_IN_FLIGHT) });
    let router = Router::new().fallback(handle).with_state(server);
    tauri::async_runtime::spawn(async move {
        let Ok(listener) = tokio::net::TcpListener::from_std(listener) else { return };
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = stopped.await;
            })
            .await;
    });
    Ok(Running { port, shutdown: Some(shutdown) })
}

async fn handle(State(server): State<Arc<Server>>, request: Request) -> Response {
    let Ok(_slot) = server.slots.acquire().await else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let (parts, body) = request.into_parts();
    let header = |name: &str| parts.headers.get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
    let origin = header("origin");
    let host_name = header("host");
    let private_network = header("access-control-request-private-network").is_some_and(|v| v.eq_ignore_ascii_case("true"));
    let method = parts.method;
    let Ok(body) = axum::body::to_bytes(body, MAX_BODY).await else {
        return (StatusCode::PAYLOAD_TOO_LARGE, "the request is too large").into_response();
    };
    let host = server.host.clone();
    let reply = tauri::async_runtime::spawn_blocking(move || {
        protocol::respond(
            &*host,
            &HttpRequest {
                method: method.as_str(),
                origin: origin.as_deref(),
                host: host_name.as_deref(),
                private_network,
                body: &body,
            },
        )
    })
    .await;
    let Ok(reply) = reply else {
        return (StatusCode::INTERNAL_SERVER_ERROR, "the request failed").into_response();
    };
    let mut response = Response::builder().status(reply.status);
    for (name, value) in reply.headers {
        response = response.header(name, value);
    }
    response
        .body(axum::body::Body::from(reply.body))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}
