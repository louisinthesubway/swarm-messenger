#!/bin/bash
# Copyright 2026 SWARM
# SPDX-License-Identifier: AGPL-3.0-only
#
# SWARM addition (M4): the .deb postrm, set as build.deb.afterRemove in
# package.json. It is electron-builder 26.11.1's templates/linux/after-remove.tpl
# as patched by patches/app-builder-lib.patch, removing SWARM's green.swarm.*
# polkit policies instead of upstream's own ones (see after-install.tpl beside
# this file).

# Delete the link to the binary
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/usr/bin/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

# Remove apparmor profile.
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  rm -f "$APPARMOR_PROFILE_DEST"
fi

# SWARM CHANGES BEGIN (upstream's patch removes its own policies here)

POLKIT_TARGET_PATH='/usr/share/polkit-1/actions'
if [ -d "$POLKIT_TARGET_PATH" ]; then
 rm -f $POLKIT_TARGET_PATH/green.swarm.${sanitizedName}.*.policy
fi

# SWARM CHANGES END
