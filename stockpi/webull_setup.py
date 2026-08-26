#!/usr/bin/env python3
"""Interactive setup/verification for the Farm dashboard Webull connection.

This helper only performs account-list, balance, positions, watchlist, and market
snapshot queries through webull_readonly.py. It does not expose order operations.
"""
from pathlib import Path
import argparse
import os
import sys

from webull_readonly import WebullReadOnly, load_env_file


def write_env(path: Path, updates: dict[str, str]):
    current = load_env_file(path)
    current.update({k: str(v) for k, v in updates.items()})
    order = [
        "WEBULL_APP_KEY", "WEBULL_APP_SECRET", "WEBULL_ENVIRONMENT",
        "WEBULL_REGION_ID", "WEBULL_ACCOUNT_ID", "WEBULL_USE_MARKET_DATA",
        "WEBULL_OPENAPI_TOKEN_DIR",
    ]
    lines = ["# Local Webull OpenAPI settings. NEVER commit this file."]
    for key in order:
        if key in current:
            lines.append(f"{key}={current[key]}")
    for key, value in current.items():
        if key not in order:
            lines.append(f"{key}={value}")
    path.write_text("\n".join(lines) + "\n")
    path.chmod(0o600)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", default=str(Path(__file__).resolve().parent / "webull.env"))
    args = parser.parse_args()
    env_path = Path(args.env).expanduser().resolve()
    os.environ["WEBULL_ENV_FILE"] = str(env_path)

    print("\nWebull read-only dashboard verification")
    print("Only account, balance, position, watchlist and market-data GET/query calls are used.")
    print("If Webull 2FA is enabled, the first request may wait for approval in the Webull app.")
    print("Open Webull → Menu → Messages → OpenAPI Notifications if the prompt does not appear.\n")

    client = WebullReadOnly(env_path.parent)
    if not client.configured:
        print("Webull credentials or SDK are not configured.")
        return 2

    try:
        accounts = client.accounts(force=True)
    except Exception as exc:
        print(f"Connection failed: {exc}")
        return 3

    if not accounts:
        print("Webull returned no accessible accounts.")
        return 4

    print("Accessible accounts:")
    for i, account in enumerate(accounts, 1):
        safe = client._safe_account(account)
        label = safe.get("account_name") or safe.get("account_type") or "Webull account"
        aid = safe.get("account_id")
        print(f"  {i}. {label}  [{aid}]")

    current = load_env_file(env_path).get("WEBULL_ACCOUNT_ID", "")
    selected = current if any(client.account_identifier(a) == current for a in accounts) else ""
    if not selected:
        if len(accounts) == 1:
            selected = client.account_identifier(accounts[0])
        else:
            while True:
                raw = input(f"Select the account for the Farm dashboard [1-{len(accounts)}]: ").strip()
                try:
                    index = int(raw) - 1
                    if 0 <= index < len(accounts):
                        selected = client.account_identifier(accounts[index])
                        break
                except ValueError:
                    pass
                print("Please enter one of the account numbers shown above.")

    write_env(env_path, {"WEBULL_ACCOUNT_ID": selected})
    client = WebullReadOnly(env_path.parent)
    summary = client.summary(force=True)
    if not summary.get("connected"):
        print(f"Account selected, but data verification failed: {summary.get('error')}")
        return 5

    b = summary.get("balance", {})
    print("\nConnection verified.")
    print(f"  Positions: {len(summary.get('positions', []))}")
    print(f"  Watchlists: {len(summary.get('watchlists', []))}")
    if b.get("cash") is not None: print(f"  Cash: ${b['cash']:,.2f}")
    if b.get("buying_power") is not None: print(f"  Buying power: ${b['buying_power']:,.2f}")
    if b.get("day_pl") is not None: print(f"  Day P/L: ${b['day_pl']:,.2f}")
    print("\nThe Farm dashboard can now use Webull account data. No order endpoint is configured in this integration.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
