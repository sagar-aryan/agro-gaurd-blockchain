import json
import os
from dataclasses import dataclass
from typing import Optional


@dataclass
class HederaSubmitResult:
    sequence: Optional[str]
    consensus_timestamp: Optional[str]


class HederaTopicClient:
    def __init__(self):
        self.account_id = os.getenv("HEDERA_ACCOUNT_ID")
        self.private_key = os.getenv("HEDERA_PRIVATE_KEY")
        self.topic_id = os.getenv("HEDERA_TOPIC_ID")
        self.network = os.getenv("HEDERA_NETWORK", "testnet").lower()
        self._client = None
        self._availability_error: Optional[str] = None

    def get_availability_error(self) -> Optional[str]:
        if self._availability_error is not None:
            return self._availability_error

        missing_fields = []
        if not self.account_id:
            missing_fields.append("HEDERA_ACCOUNT_ID")
        if not self.private_key:
            missing_fields.append("HEDERA_PRIVATE_KEY")
        if not self.topic_id:
            missing_fields.append("HEDERA_TOPIC_ID")

        if missing_fields:
            self._availability_error = f"missing environment variables: {', '.join(missing_fields)}"
            return self._availability_error

        try:
            self._require_sdk()
        except RuntimeError as exc:
            self._availability_error = str(exc)
            return self._availability_error

        return None

    def _require_sdk(self):
        try:
            from hedera import AccountId, Client, PrivateKey, TopicId, TopicMessageSubmitTransaction
        except ImportError as exc:
            raise RuntimeError("hedera-sdk-py is not installed") from exc

        return {
            "AccountId": AccountId,
            "Client": Client,
            "PrivateKey": PrivateKey,
            "TopicId": TopicId,
            "TopicMessageSubmitTransaction": TopicMessageSubmitTransaction,
        }

    @staticmethod
    def _call_first_available(target, method_names, *args):
        last_error = None
        for method_name in method_names:
            method = getattr(target, method_name, None)
            if method is None:
                continue
            try:
                return method(*args)
            except Exception as exc:
                last_error = exc
        if last_error is not None:
            raise last_error
        raise RuntimeError(f"Missing Hedera SDK method on {target}")

    def _build_client(self):
        availability_error = self.get_availability_error()
        if availability_error is not None:
            raise RuntimeError(availability_error)

        sdk = self._require_sdk()
        client_type = sdk["Client"]
        private_key_type = sdk["PrivateKey"]
        account_id_type = sdk["AccountId"]

        network_methods = {
            "mainnet": ("forMainnet", "for_mainnet"),
            "previewnet": ("forPreviewnet", "for_previewnet"),
            "testnet": ("forTestnet", "for_testnet"),
        }
        client = self._call_first_available(
            client_type,
            network_methods.get(self.network, network_methods["testnet"]),
        )

        operator_id = self._call_first_available(
            account_id_type,
            ("fromString", "from_string"),
            self.account_id,
        )
        operator_key = self._call_first_available(
            private_key_type,
            ("fromString", "from_string", "fromStringED25519", "from_string_ed25519"),
            self.private_key,
        )

        self._call_first_available(client, ("setOperator", "set_operator"), operator_id, operator_key)
        return client

    def _get_client(self):
        if self._client is None:
            self._client = self._build_client()
        return self._client

    def submit_intruder_hash(self, sha256_hash: str, local_time: str) -> HederaSubmitResult:
        availability_error = self.get_availability_error()
        if availability_error is not None:
            raise RuntimeError(availability_error)

        sdk = self._require_sdk()
        topic_id_type = sdk["TopicId"]
        submit_txn_type = sdk["TopicMessageSubmitTransaction"]

        topic_id = self._call_first_available(
            topic_id_type,
            ("fromString", "from_string"),
            self.topic_id,
        )

        message = json.dumps(
            {
                "type": "INTRUDER",
                "hash": sha256_hash,
                "local_time": local_time,
            },
            separators=(",", ":"),
        )

        client = self._get_client()
        txn = submit_txn_type()
        self._call_first_available(txn, ("setTopicId", "set_topic_id"), topic_id)
        self._call_first_available(txn, ("setMessage", "set_message"), message)

        response = self._call_first_available(txn, ("execute",), client)
        receipt = self._call_first_available(response, ("getReceipt", "get_receipt"), client)
        record = self._call_first_available(response, ("getRecord", "get_record"), client)

        sequence = getattr(receipt, "topicSequenceNumber", None)
        if sequence is None:
            sequence = getattr(receipt, "topic_sequence_number", None)

        consensus_timestamp = getattr(record, "consensusTimestamp", None)
        if consensus_timestamp is None:
            consensus_timestamp = getattr(record, "consensus_timestamp", None)

        return HederaSubmitResult(
            sequence=str(sequence) if sequence is not None else None,
            consensus_timestamp=str(consensus_timestamp) if consensus_timestamp is not None else None,
        )
