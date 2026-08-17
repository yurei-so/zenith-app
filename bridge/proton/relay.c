#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <windows.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define RELAY_PORT 38423
#define MUMBLE_LINK_SIZE 5460
#define FILE_MAP_READ_ACCESS 0x0004
#define PAGE_READWRITE_ACCESS 0x04

#pragma pack(push, 1)
typedef struct {
    uint32_t uiVersion;
    uint32_t uiTick;
    float avatarPosition[3];
    float avatarFront[3];
    float avatarTop[3];
    wchar_t name[256];
    float cameraPosition[3];
    float cameraFront[3];
    float cameraTop[3];
    wchar_t identity[256];
    uint32_t contextLength;
    unsigned char context[256];
    wchar_t description[2048];
} LinkedMem;

typedef struct {
    unsigned char serverAddress[28];
    uint32_t mapId;
    uint32_t mapType;
    uint32_t shardId;
    uint32_t instance;
    uint32_t buildId;
    uint32_t uiState;
    uint16_t compassWidth;
    uint16_t compassHeight;
    float compassRotation;
    float playerX;
    float playerY;
    float mapCenterX;
    float mapCenterY;
    float compassScale;
    uint32_t processId;
    uint8_t mountIndex;
} Gw2Context;

typedef struct {
    char magic[4];
    uint16_t version;
    uint16_t size;
    uint32_t tick;
    uint32_t mapId;
    uint32_t buildId;
    uint32_t uiState;
    uint32_t processId;
    float playerX;
    float playerY;
    float heading;
    uint8_t mountIndex;
    uint8_t reserved[3];
    char characterName[128];
    float cameraPosition[3];
    float cameraFront[3];
} ZenithPacket;
#pragma pack(pop)

static void copy_character_name(char *destination, size_t destination_size, const wchar_t *identity) {
    destination[0] = '\0';
    if (!identity || !identity[0]) return;

    const wchar_t *name = wcsstr(identity, L"\"name\":\"");
    if (!name) return;
    name += 8;
    const wchar_t *end = wcschr(name, L'"');
    if (!end || end <= name) return;

    int wide_length = (int)(end - name);
    WideCharToMultiByte(
        CP_UTF8,
        0,
        name,
        wide_length,
        destination,
        (int)destination_size - 1,
        NULL,
        NULL
    );
    destination[destination_size - 1] = '\0';
}

int main(void) {
    WSADATA winsock;
    SOCKET socket_handle = INVALID_SOCKET;
    HANDLE mapping = NULL;
    const LinkedMem *linked = NULL;
    uint32_t last_tick = 0;
    struct sockaddr_in destination;

    if (WSAStartup(MAKEWORD(2, 2), &winsock) != 0) return 2;
    socket_handle = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (socket_handle == INVALID_SOCKET) {
        WSACleanup();
        return 3;
    }

    memset(&destination, 0, sizeof(destination));
    destination.sin_family = AF_INET;
    destination.sin_port = htons(RELAY_PORT);
    destination.sin_addr.s_addr = htonl(INADDR_LOOPBACK);

    for (;;) {
        if (!linked) {
            mapping = OpenFileMappingW(FILE_MAP_READ_ACCESS, FALSE, L"MumbleLink");
            if (!mapping) {
                mapping = CreateFileMappingW(
                    INVALID_HANDLE_VALUE,
                    NULL,
                    PAGE_READWRITE_ACCESS,
                    0,
                    MUMBLE_LINK_SIZE,
                    L"MumbleLink"
                );
            }
            if (mapping) {
                linked = (const LinkedMem *)MapViewOfFile(
                    mapping,
                    FILE_MAP_READ_ACCESS,
                    0,
                    0,
                    MUMBLE_LINK_SIZE
                );
                if (!linked) {
                    CloseHandle(mapping);
                    mapping = NULL;
                }
            }
            if (!linked) {
                Sleep(1000);
                continue;
            }
        }

        LinkedMem snapshot;
        memcpy(&snapshot, linked, sizeof(snapshot));
        if (snapshot.uiVersion == 0 || snapshot.uiTick == 0 || snapshot.uiTick == last_tick) {
            Sleep(100);
            continue;
        }
        last_tick = snapshot.uiTick;
        const Gw2Context *context = (const Gw2Context *)snapshot.context;

        ZenithPacket packet;
        memset(&packet, 0, sizeof(packet));
        memcpy(packet.magic, "ZNML", 4);
        packet.version = 2;
        packet.size = (uint16_t)sizeof(packet);
        packet.tick = snapshot.uiTick;
        packet.mapId = context->mapId;
        packet.buildId = context->buildId;
        packet.uiState = context->uiState;
        packet.processId = context->processId;
        packet.playerX = context->playerX;
        packet.playerY = context->playerY;
        packet.heading = atan2f(snapshot.avatarFront[0], -snapshot.avatarFront[2]);
        packet.mountIndex = context->mountIndex;
        copy_character_name(packet.characterName, sizeof(packet.characterName), snapshot.identity);
        memcpy(packet.cameraPosition, snapshot.cameraPosition, sizeof(packet.cameraPosition));
        memcpy(packet.cameraFront, snapshot.cameraFront, sizeof(packet.cameraFront));

        sendto(
            socket_handle,
            (const char *)&packet,
            sizeof(packet),
            0,
            (const struct sockaddr *)&destination,
            sizeof(destination)
        );
        Sleep(100);
    }

    return 0;
}
