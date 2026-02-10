# TT-CableGen Dockerfile

#############################################################

# Use the published tt-metal base image instead of rebuilding
# This includes basic build tools (cmake, ninja, g++, mpi-ulfm)
FROM ghcr.io/tenstorrent/tt-metal/tt-metalium-ubuntu-22.04-release-amd64:latest AS base

#############################################################

FROM base AS release

# Set up TT_METAL_HOME
# (PYTHON_ENV_DIR is already set in the base image)
ENV TT_METAL_HOME=/tt-metal
ENV APP_HOME=/app
ARG TT_METAL_HASH=9a790e2201de81a40fb66132e6774b84748e4775

COPY requirements.txt requirements.txt
RUN /bin/bash -c "pip install --no-cache-dir -r requirements.txt; apt update && apt install -y protobuf-compiler npm"

# Clone tt-metal for scaleout dependencies
RUN /bin/bash -c "git clone --filter=blob:none --recurse-submodules --tags \
    https://github.com/tenstorrent/tt-metal.git ${TT_METAL_HOME} \
    && cd ${TT_METAL_HOME}"

WORKDIR ${TT_METAL_HOME}

# Fetch and checkout the exact commit (shallow fetch for that commit only)
RUN /bin/bash -c "git fetch origin ${TT_METAL_HASH} && git checkout ${TT_METAL_HASH}"

ENV toolchain_path=cmake/x86_64-linux-clang-17-libstdcpp-toolchain.cmake
COPY build_scaleout.sh ${TT_METAL_HOME}/build_scaleout.sh
RUN chmod +x ${TT_METAL_HOME}/build_scaleout.sh

RUN /bin/bash -c "${TT_METAL_HOME}/build_scaleout.sh --build-dir build"

WORKDIR ${APP_HOME}
# Copy Flask web server files
# Bust docker build cache
ARG CACHEBUST=1
RUN echo "Busting docker build cache at $(date): $CACHEBUST"

COPY templates/ ${APP_HOME}/templates/
COPY server.py ${APP_HOME}/server.py
COPY import_cabling.py ${APP_HOME}/import_cabling.py
COPY export_descriptors.py ${APP_HOME}/export_descriptors.py
COPY static/ ${APP_HOME}/static/

# Expose ports for tt-cablegen server
# Port 5000: Web server
EXPOSE 5000


# Set the Flask server as the entrypoint
# This allows passing command line arguments directly to docker run
ENTRYPOINT ["/bin/bash", "-c", "python3 ${APP_HOME}/server.py -p 5000"]

#############################################################

