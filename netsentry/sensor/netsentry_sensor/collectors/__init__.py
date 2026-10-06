"""Collector registry — ids match the console's lib/collectors/sensor.js."""

from .accounts import Accounts
from .auth import AuthLog
from .cloud import Cloud
from .code import Dependencies, Secrets
from .containers import AppConfig, Containers
from .health import ContainerStats, Disks, HostHealth, Services
from .host import HostInfo, Listeners, Ssh, Users
from .net import Connections, Dns, Ids
from .probe import Apps, Router
from .storage import Storage
from .remote import RemoteAccess
from .system import Docker, Fim, Persistence, Posture, Updates

ALL = [HostInfo, Listeners, Users, Ssh, Updates, AuthLog, Persistence, Fim, Posture, Docker, Connections, Dns, Ids, Cloud, Dependencies, Secrets, Containers, AppConfig, Storage, Router, Apps, RemoteAccess, Accounts, HostHealth, ContainerStats, Services, Disks]
