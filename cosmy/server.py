from __future__ import annotations

import uvicorn

from .config import Settings


def main() -> None:
    settings = Settings.from_env()
    uvicorn.run(
        "cosmy.app:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
        loop="auto",
        http="auto",
        workers=1,
        access_log=settings.environment != "production",
    )


if __name__ == "__main__":
    main()
