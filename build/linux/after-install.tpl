#!/bin/bash
# Copyright 2026 SWARM
# SPDX-License-Identifier: AGPL-3.0-only
#
# SWARM addition (M4): the .deb postinst, set as build.deb.afterInstall in
# package.json. It is electron-builder 26.11.1's templates/linux/after-install.tpl
# as patched by patches/app-builder-lib.patch, with one difference: the polkit
# policies are SWARM's green.swarm.* files. The patch copies upstream's own
# policy files, which a SWARM build does not ship, so with the default template
# every install printed three "cp: cannot stat" errors and never registered
# the green.swarm.* actions that ts/util/os/promptOSAuthMain.main.ts asks
# pkcheck about. Nothing in this script may name upstream's policies: the
# installer-linux CI job fails if it does.

if type update-alternatives >/dev/null 2>&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Check if user namespaces are supported by the kernel and working with a quick test:
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# Install apparmor profile. (Ubuntu 24+)
# First check if the version of AppArmor running on the device supports our profile.
# This is in order to keep backwards compatibility with Ubuntu 22.04 which does not support abi/4.0.
# In that case, we just skip installing the profile since the app runs fine without it on 22.04.
#
# Those apparmor_parser flags are akin to performing a dry run of loading a profile.
# https://wiki.debian.org/AppArmor/HowToUse#Dumping_profiles
#
# Unfortunately, at the moment AppArmor doesn't have a good story for backwards compatibility.
# https://askubuntu.com/questions/1517272/writing-a-backwards-compatible-apparmor-profile
if apparmor_status --enabled > /dev/null 2>&1; then
  APPARMOR_PROFILE_SOURCE='/opt/${sanitizedProductName}/resources/apparmor-profile'
  APPARMOR_PROFILE_TARGET='/etc/apparmor.d/${executable}'
  if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" > /dev/null 2>&1; then
    cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"

    # Updating the current AppArmor profile is not possible and probably not meaningful in a chroot'ed environment.
    # Use cases are for example environments where images for clients are maintained.
    # There, AppArmor might correctly be installed, but live updating makes no sense.
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      # Extra flags taken from dh_apparmor:
      # > By using '-W -T' we ensure that any abstraction updates are also pulled in.
      # https://wiki.debian.org/AppArmor/Contribute/FirstTimeProfileImport
      apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET"
    fi
  else
    echo "Skipping the installation of the AppArmor profile as this version of AppArmor does not seem to support the bundled profile"
  fi
fi

# SWARM CHANGES BEGIN (upstream's patch installs its own policies here)

if command -v pkcheck >/dev/null 2>&1; then
  POLICY_SOURCE_PATH='/opt/${sanitizedProductName}/resources'
  POLICY_TARGET_PATH='/usr/share/polkit-1/actions'
  POLICY_ORG='green.swarm'
  POLICY_ENABLE_BACKUPS='enable-backups.policy'
  POLICY_VIEW_AEP='view-aep.policy'
  POLICY_EXPORT='plaintext-export.policy'
  mkdir -p "$POLICY_TARGET_PATH";
  cp -f "$POLICY_SOURCE_PATH/$POLICY_ORG.$POLICY_ENABLE_BACKUPS" "$POLICY_TARGET_PATH/$POLICY_ORG.${sanitizedName}.$POLICY_ENABLE_BACKUPS"
  cp -f "$POLICY_SOURCE_PATH/$POLICY_ORG.$POLICY_VIEW_AEP" "$POLICY_TARGET_PATH/$POLICY_ORG.${sanitizedName}.$POLICY_VIEW_AEP"
  cp -f "$POLICY_SOURCE_PATH/$POLICY_ORG.$POLICY_EXPORT" "$POLICY_TARGET_PATH/$POLICY_ORG.${sanitizedName}.$POLICY_EXPORT"
else
  echo "Skipping installation of policies as polkit does not seem to be installed. This may affect the availability of some features.";
fi

# Marker file ts/updater/linux.main.ts looks for; the name is upstream's and is
# kept so that code keeps working. SWARM Messenger never updates itself.
touch '/opt/${sanitizedProductName}/.signal-postinst'

# SWARM CHANGES END
