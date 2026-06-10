# TT-CableGen Dockerfile (slim, multi-stage)
#
# builder: compiles scaleout tools using the heavy tt-metal image (discarded).
# release: minimal ubuntu carrying only the runtime closure the app uses.
# dev:     release + npm for in-container Jest/pytest checks.

#############################################################
# Builder
#############################################################
FROM ghcr.io/tenstorrent/tt-metal/tt-metalium-ubuntu-22.04-release-amd64:latest AS builder

ENV TT_METAL_HOME=/tt-metal
ARG TT_METAL_HASH=fbb677b7197ee126f76c9ebbfc2ba28b6d980442

RUN apt-get update \
    && apt-get install -y --no-install-recommends protobuf-compiler git \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --filter=blob:none --tags https://github.com/tenstorrent/tt-metal.git ${TT_METAL_HOME}
WORKDIR ${TT_METAL_HOME}
RUN git fetch origin ${TT_METAL_HASH} \
    && git checkout ${TT_METAL_HASH} \
    && git submodule update --init --recursive

COPY build_scaleout.sh ${TT_METAL_HOME}/build_scaleout.sh
RUN chmod +x build_scaleout.sh && ./build_scaleout.sh --build-dir build

#############################################################
# Release (minimal runtime)
#############################################################
FROM ubuntu:22.04 AS release

ENV TT_METAL_HOME=/tt-metal
ENV APP_HOME=/app
ENV PYTHON_ENV_DIR=/opt/venv
ENV PATH=/opt/venv/bin:${PATH}

# Runtime shared-lib deps of run_cabling_generator (see ldd closure) + python.
# glibc/libstdc++/libgcc/krb5 sub-libs come transitively or from the base.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 python3-venv \
        libhwloc15 libtirpc3 libudev1 libnsl2 libatomic1 zlib1g libgssapi-krb5-2 \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv ${PYTHON_ENV_DIR}
COPY requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Built artifacts. Paths are preserved verbatim: the binary's RUNPATH points at
# /tt-metal/build/tt_stl and /tt-metal/build/tt_metal/third_party/umd/device, and
# server.py/import_cabling.py/export_descriptors.py resolve everything under
# $TT_METAL_HOME/build/tools/scaleout.
COPY --from=builder /tt-metal/build/tools/scaleout/run_cabling_generator /tt-metal/build/tools/scaleout/run_cabling_generator
COPY --from=builder /tt-metal/build/tt_stl/libtt_stl.so /tt-metal/build/tt_stl/libtt_stl.so
COPY --from=builder /tt-metal/build/tt_metal/third_party/umd/device/libdevice.so /tt-metal/build/tt_metal/third_party/umd/device/libdevice.so
COPY --from=builder /tt-metal/build/tools/scaleout/protobuf/cluster_config_pb2.py /tt-metal/build/tools/scaleout/protobuf/cluster_config_pb2.py
COPY --from=builder /tt-metal/build/tools/scaleout/protobuf/node_config_pb2.py /tt-metal/build/tools/scaleout/protobuf/node_config_pb2.py
COPY --from=builder /tt-metal/build/tools/scaleout/protobuf/deployment_pb2.py /tt-metal/build/tools/scaleout/protobuf/deployment_pb2.py

WORKDIR ${APP_HOME}
COPY templates/ ${APP_HOME}/templates/
COPY server.py ${APP_HOME}/server.py
COPY import_cabling.py ${APP_HOME}/import_cabling.py
COPY export_descriptors.py ${APP_HOME}/export_descriptors.py
COPY static/ ${APP_HOME}/static/

EXPOSE 5000
ENTRYPOINT ["/bin/bash", "-c", "python3 ${APP_HOME}/server.py -p 5000"]

#############################################################
# Dev / test (adds npm for in-container checks)
#############################################################
FROM release AS dev
RUN apt-get update \
    && apt-get install -y --no-install-recommends npm \
    && rm -rf /var/lib/apt/lists/*
